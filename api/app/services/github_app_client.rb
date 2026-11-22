require "digest"
require "jwt"
require "openssl"

# The only App HTTP boundary. Provider failures never include response bodies,
# headers, tokens or key material in errors. Cache tokens in this process only.
class GithubAppClient
  class Error < StandardError
    attr_reader :status, :retry_after

    def initialize(message, status: nil, retry_after: nil, rate_limited: false)
      @status = status
      @retry_after = retry_after
      @rate_limited = rate_limited
      super(message)
    end

    def rate_limited? = @rate_limited == true

    def transient?
      rate_limited? ||
        status == 429 ||
        (status && status >= 500) ||
        (status.nil? && message == PROVIDER_ERROR)
    end
  end

  class InconclusiveSearchError < Error; end
  class BudgetExceeded < StandardError; end

  PROVIDER_ERROR = "GitHub is temporarily unavailable; try again".freeze
  DEFAULT_TIMEOUT = 10
  MARKER_SEARCH_MAX_PAGES = 5
  MARKER_SEARCH_PER_PAGE = 100
  BASE = "https://api.github.com".freeze
  TOKEN_CACHE = ActiveSupport::Cache::MemoryStore.new(size: 1.megabyte)

  def initialize(transport: HTTParty, cache: TOKEN_CACHE, credentials: GithubAppCredentials, now: -> { Time.current })
    @transport, @cache, @credentials, @now = transport, cache, credentials, now
  end

  def installation(installation_id, timeout: nil)
    result = request(:get, "/app/installations/#{Integer(installation_id)}", token: app_jwt, timeout: timeout)
    account = result.fetch("account")
    unless result.fetch("id").to_i == Integer(installation_id) && account.is_a?(Hash) && positive_id?(account.fetch("id")) && account.fetch("login").is_a?(String) &&
        %w[User Organization].include?(account.fetch("type")) && %w[all selected].include?(result.fetch("repository_selection")) && result.fetch("permissions").is_a?(Hash)
      raise Error, PROVIDER_ERROR
    end
    raise Error, "Installation belongs to another GitHub App" unless result.fetch("app_id").to_s == @credentials.app_id
    raise Error, "GitHub installation is suspended; reconnect access" if result["suspended_at"].present?

    result
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def repository(installation:, full_name:, repository_id: nil, timeout: nil, deadline: nil, monotonic: nil)
    # Restrict a second token to this numeric repo. GitHub rejects repository_ids
    # outside this installation, including readable public but unselected repos.
    path = repository_id ? "/repositories/#{Integer(repository_id)}" : "/repos/#{full_name}"
    repo = installation_request(
      installation, :get, path,
      repository_id: repository_id, timeout: timeout, deadline: deadline, monotonic: monotonic
    )
    id = Integer(repo.fetch("id"))
    unless positive_id?(id) && repo.fetch("full_name").is_a?(String) && repo.fetch("owner").is_a?(Hash) && positive_id?(repo.fetch("owner").fetch("id")) &&
        repo.fetch("owner").fetch("login").is_a?(String) && %w[User Organization].include?(repo.fetch("owner").fetch("type")) && [ true, false ].include?(repo.fetch("fork"))
      raise Error, PROVIDER_ERROR
    end
    installation_token(installation, repository_id: id, timeout: timeout, deadline: deadline, monotonic: monotonic)
    repo
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def default_branch_head(installation:, repository:, timeout: nil, deadline: nil, monotonic: nil)
    repo = source_query(
      installation, repository,
      "defaultBranchRef { name target { ... on Commit { oid committedDate } } }",
      timeout: timeout, deadline: deadline, monotonic: monotonic
    )
    branch = repo.fetch("defaultBranchRef")
    target = branch&.fetch("target")
    sha = target&.fetch("oid")
    raise Error, "GitHub repository has no submitted commit" unless sha.to_s.match?(/\A[0-9a-f]{40,64}\z/i)

    committed_at = target["committedDate"].present? ? Time.iso8601(target["committedDate"].to_s) : nil
    { commit_hash: sha, branch: branch.fetch("name"), committed_at: committed_at }
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def files_at_commit(installation:, repository:, sha:, branch:, filenames:, workflow_paths: [], timeout: nil, deadline: nil, monotonic: nil)
    raise Error, "GitHub repository has no submitted commit" unless sha.to_s.match?(/\A[0-9a-f]{40,64}\z/i)

    normalized_workflows = Array(workflow_paths).filter_map { |path| path.to_s.strip.presence }.uniq
    return { files: [], workflow_files: {}, commit_hash: sha, branch: branch, error: nil } if filenames.empty? && normalized_workflows.empty?

    fragments = filenames.each_with_index.map do |filename, index|
      "file_#{index}: object(expression: #{"#{sha}:#{filename}".to_json}) { ... on Blob { text byteSize isTruncated } }"
    end
    normalized_workflows.each_with_index do |workflow_path, index|
      fragments << "workflow_#{index}: object(expression: #{"#{sha}:#{workflow_path}".to_json}) { ... on Blob { oid text byteSize isTruncated } }"
    end
    repo = source_query(installation, repository, fragments.join("\n"), timeout: timeout, deadline: deadline, monotonic: monotonic)
    files = filenames.each_with_index.filter_map do |filename, index|
      blob = repo.fetch("file_#{index}")
      next unless blob

      raise Error, "GitHub returned truncated source; no revisions imported" if blob.fetch("isTruncated") == true
      text = blob.fetch("text")
      size = blob.fetch("byteSize")
      unless blob.fetch("isTruncated") == false && size.is_a?(Integer) && text.is_a?(String) && size == text.bytesize
        raise Error, "GitHub did not return complete UTF-8 source; no revisions imported"
      end

      { "name" => filename, "text" => text }
    end
    workflow_files = normalized_workflows.each_with_index.each_with_object({}) do |(workflow_path, index), captured|
      blob = repo.fetch("workflow_#{index}")
      unless blob
        captured[workflow_path] = { "present" => false }
        next
      end

      oid = blob["oid"].to_s
      valid_oid = oid.match?(/\A[0-9a-f]{40,64}\z/i) ? oid.downcase : nil
      text = blob["text"]
      size = blob["byteSize"]
      complete_text = blob["isTruncated"] == false && text.is_a?(String) && size.is_a?(Integer) && size == text.bytesize

      if valid_oid && complete_text
        captured[workflow_path] = {
          "present" => true,
          "oid" => valid_oid,
          "sha256" => Digest::SHA256.hexdigest(text)
        }
      else
        # Binary (text: nil) or truncated workflow blobs never abort importing valid
        # student exercise files; grade-suggestion evaluation fails closed on unreadable.
        captured[workflow_path] = {
          "present" => true,
          "unreadable" => true,
          "oid" => valid_oid,
          "sha256" => nil
        }
      end
    end
    { files: files, workflow_files: workflow_files, commit_hash: sha, branch: branch, error: nil }
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def files(installation:, repository:, filenames:, workflow_paths: [], timeout: nil)
    # Resolve once, then fetch every blob at that commit. HEAD:path and the
    # branch tip in the same GraphQL query can observe different revisions.
    head = default_branch_head(installation: installation, repository: repository, timeout: timeout)
    files_at_commit(
      installation: installation,
      repository: repository,
      sha: head.fetch(:commit_hash),
      branch: head.fetch(:branch),
      filenames: filenames,
      workflow_paths: workflow_paths,
      timeout: timeout
    )
  end

  def checks(installation:, repository_id:, full_name:, sha:, page:, timeout: nil, deadline: nil, monotonic: nil)
    raise Error, "Invalid submission commit SHA" unless sha.to_s.match?(/\A[a-fA-F0-9]{6,64}\z/)

    result = installation_request(
      installation, :get, "/repos/#{full_name}/commits/#{sha}/check-runs",
      repository_id: repository_id, query: { filter: "latest", per_page: 100, page: page },
      timeout: timeout, deadline: deadline, monotonic: monotonic
    )
    unless result.fetch("check_runs").is_a?(Array) && result.fetch("total_count").is_a?(Integer) && result["total_count"] >= 0
      raise Error, PROVIDER_ERROR
    end
    result
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def find_issue_by_marker(installation:, repository_id:, full_name:, marker:, issue_number: nil, max_pages: MARKER_SEARCH_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
    found = find_issue_by_markers(
      installation: installation,
      repository_id: repository_id,
      full_name: full_name,
      markers: [ marker ],
      issue_number: issue_number,
      max_pages: max_pages,
      timeout: timeout,
      deadline: deadline,
      monotonic: monotonic
    )
    found&.except("matched_marker")
  end

  def find_issue_by_markers(installation:, repository_id:, full_name:, markers:, issue_number: nil, max_pages: MARKER_SEARCH_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
    validate_repo_target!(repository_id: repository_id, full_name: full_name)
    marker_list = Array(markers).select { |m| m.is_a?(String) && m.present? }.uniq
    raise Error, PROVIDER_ERROR if marker_list.empty?

    pages_limit = Integer(max_pages)
    raise Error, PROVIDER_ERROR unless pages_limit.positive?

    if issue_number
      num = validate_issue_number!(issue_number)
      inconclusive = false

      1.upto(pages_limit) do |page|
        page_timeout = resolve_request_timeout(timeout: timeout, deadline: deadline, monotonic: monotonic)
        comments, headers = installation_request(
          installation,
          :get,
          "/repos/#{full_name}/issues/#{num}/comments",
          repository_id: repository_id,
          query: { per_page: MARKER_SEARCH_PER_PAGE, page: page },
          expect: Array,
          include_headers: true,
          timeout: page_timeout
        )
        matched_marker = nil
        comments.each do |item|
          next unless item.is_a?(Hash)

          body = item["body"].to_s
          matched_marker = marker_list.find { |m| body.include?(m) }
          break if matched_marker
        end
        if matched_marker
          issue_timeout = resolve_request_timeout(timeout: timeout, deadline: deadline, monotonic: monotonic)
          issue = get_issue(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: num, timeout: issue_timeout)
          return issue.merge("matched_comment" => true, "matched_marker" => matched_marker)
        end

        more_pages = has_next_page?(headers) || comments.size >= MARKER_SEARCH_PER_PAGE
        break unless more_pages

        inconclusive = true if page == pages_limit
      end

      issue_timeout = resolve_request_timeout(timeout: timeout, deadline: deadline, monotonic: monotonic)
      issue = get_issue(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: num, timeout: issue_timeout)
      body_marker = marker_list.find { |m| issue["body"].to_s.include?(m) }
      return issue.merge("matched_marker" => body_marker) if body_marker

      if inconclusive
        raise InconclusiveSearchError, "Could not confirm whether GitHub feedback was already posted after checking #{pages_limit} pages; inspect the repository before retrying"
      end

      return nil
    end

    1.upto(pages_limit) do |page|
      page_timeout = resolve_request_timeout(timeout: timeout, deadline: deadline, monotonic: monotonic)
      issues, headers = installation_request(
        installation,
        :get,
        "/repos/#{full_name}/issues",
        repository_id: repository_id,
        query: { state: "all", sort: "updated", direction: "desc", per_page: MARKER_SEARCH_PER_PAGE, page: page },
        expect: Array,
        include_headers: true,
        timeout: page_timeout
      )
      issues.each do |item|
        next unless item.is_a?(Hash) && !item.key?("pull_request")

        body = item["body"].to_s
        matched_marker = marker_list.find { |m| body.include?(m) }
        return normalize_issue!(item).merge("matched_marker" => matched_marker) if matched_marker
      end

      more_pages = has_next_page?(headers) || issues.size >= MARKER_SEARCH_PER_PAGE
      return nil unless more_pages
    end

    raise InconclusiveSearchError, "Could not confirm whether GitHub feedback was already posted after checking #{pages_limit} pages; inspect the repository before retrying"
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def create_issue(installation:, repository_id:, full_name:, title:, body:, timeout: nil)
    validate_repo_target!(repository_id: repository_id, full_name: full_name)
    result = installation_request(installation, :post, "/repos/#{full_name}/issues", repository_id: repository_id, body: { title: title.to_s, body: body.to_s }, timeout: timeout)
    normalize_issue!(result)
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def get_issue(installation:, repository_id:, full_name:, issue_number:, timeout: nil)
    validate_repo_target!(repository_id: repository_id, full_name: full_name)
    num = validate_issue_number!(issue_number)
    result = installation_request(installation, :get, "/repos/#{full_name}/issues/#{num}", repository_id: repository_id, timeout: timeout)
    normalize_issue!(result).merge("title" => result["title"].to_s, "body" => result["body"].to_s)
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def reopen_issue(installation:, repository_id:, full_name:, issue_number:, timeout: nil)
    validate_repo_target!(repository_id: repository_id, full_name: full_name)
    num = validate_issue_number!(issue_number)
    result = installation_request(installation, :patch, "/repos/#{full_name}/issues/#{num}", repository_id: repository_id, body: { state: "open" }, timeout: timeout)
    normalize_issue!(result)
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def add_issue_comment(installation:, repository_id:, full_name:, issue_number:, body:, timeout: nil)
    validate_repo_target!(repository_id: repository_id, full_name: full_name)
    num = validate_issue_number!(issue_number)
    result = installation_request(installation, :post, "/repos/#{full_name}/issues/#{num}/comments", repository_id: repository_id, body: { body: body.to_s }, timeout: timeout)
    id = Integer(result.fetch("id"))
    url = result.fetch("html_url")
    raise Error, PROVIDER_ERROR unless positive_id?(id) && url.is_a?(String) && url.present?

    { "id" => id, "html_url" => url }
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def close_issue(installation:, repository_id:, full_name:, issue_number:, comment: nil, timeout: nil)
    validate_repo_target!(repository_id: repository_id, full_name: full_name)
    num = validate_issue_number!(issue_number)
    if comment.present?
      add_issue_comment(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: num, body: comment, timeout: timeout)
    end
    result = installation_request(installation, :patch, "/repos/#{full_name}/issues/#{num}", repository_id: repository_id, body: { state: "closed", state_reason: "completed" }, timeout: timeout)
    normalize_issue!(result)
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  private

  def source_query(installation, repository, fields, timeout: nil, deadline: nil, monotonic: nil)
    owner, name = repository.fetch("full_name").split("/")
    query = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name, followRenames: false) { fullDatabaseId #{fields} } }"
    result = installation_request(
      installation, :post, "/graphql",
      repository_id: repository.fetch("id"), body: { query: query, variables: { owner: owner, name: name } },
      timeout: timeout, deadline: deadline, monotonic: monotonic
    )
    repo = result.fetch("data").fetch("repository")
    raise Error, "GitHub repository is unavailable; verify access again" unless repo && repo.fetch("fullDatabaseId").to_i == repository.fetch("id").to_i && result["errors"].blank?

    repo
  end

  FULL_NAME_FORMAT = %r{\A[a-zA-Z0-9][a-zA-Z0-9-]{0,38}/[a-zA-Z0-9_.-]{1,100}\z}

  def validate_repo_target!(repository_id:, full_name:)
    raise Error, PROVIDER_ERROR unless positive_id?(repository_id) && full_name.is_a?(String) && FULL_NAME_FORMAT.match?(full_name)
  end

  def validate_issue_number!(issue_number)
    num = Integer(issue_number)
    raise Error, PROVIDER_ERROR unless positive_id?(num)

    num
  end

  def normalize_issue!(payload)
    number = Integer(payload.fetch("number"))
    url = payload.fetch("html_url")
    state = payload.fetch("state")
    raise Error, PROVIDER_ERROR unless positive_id?(number) && url.is_a?(String) && url.present? && %w[open closed].include?(state)

    { "number" => number, "html_url" => url, "state" => state }
  end

  def positive_id?(value)
    value.to_s.match?(/\A[1-9]\d{0,18}\z/) && value.to_i <= 9_223_372_036_854_775_807
  end

  def app_jwt
    raise Error, "GitHub App credentials are not configured" unless @credentials.configured?

    JWT.encode({ iat: @now.call.to_i - 60, exp: @now.call.to_i + 9.minutes.to_i, iss: @credentials.app_id }, OpenSSL::PKey::RSA.new(@credentials.private_key), "RS256")
  rescue OpenSSL::PKey::PKeyError, JWT::EncodeError
    raise Error, "GitHub App credentials are invalid"
  end

  def token_key(installation, repository_id)
    [ "github-app", @credentials.app_id, installation.installation_id, repository_id,
      Digest::SHA256.hexdigest(@credentials.private_key) ].join(":")
  end

  def installation_token(installation, repository_id: nil, refresh: false, timeout: nil, deadline: nil, monotonic: nil)
    key = token_key(installation, repository_id)
    @cache.delete(key) if refresh
    cached = @cache.read(key)
    return cached if cached

    call_timeout = resolve_request_timeout(timeout: timeout, deadline: deadline, monotonic: monotonic)
    payload = repository_id ? { repository_ids: [ Integer(repository_id) ] } : {}
    result = request(:post, "/app/installations/#{installation.installation_id}/access_tokens", token: app_jwt, body: payload, timeout: call_timeout)
    ttl = [ Time.iso8601(result.fetch("expires_at")) - @now.call - 60, 5.minutes.to_i ].min
    raise Error, "GitHub returned an expired installation token" unless ttl.positive? && result.fetch("token").is_a?(String) && result["token"].present?

    @cache.write(key, result.fetch("token"), expires_in: ttl)
    result.fetch("token")
  end

  def installation_request(installation, method, path, repository_id: nil, timeout: nil, deadline: nil, monotonic: nil, **options)
    attempts = 0
    begin
      token = installation_token(
        installation, repository_id: repository_id, refresh: attempts.positive?,
        timeout: timeout, deadline: deadline, monotonic: monotonic
      )
      call_timeout = resolve_request_timeout(timeout: timeout, deadline: deadline, monotonic: monotonic)
      request(method, path, token: token, timeout: call_timeout, **options)
    rescue Error => error
      if error.status == 401 && attempts.zero?
        attempts += 1
        retry
      end
      raise
    end
  end

  def request(method, path, token:, body: nil, query: nil, expect: Hash, include_headers: false, timeout: nil)
    effective_timeout = timeout ? [ timeout.to_f, DEFAULT_TIMEOUT.to_f ].min : DEFAULT_TIMEOUT
    raise BudgetExceeded, "GitHub request budget exhausted" if effective_timeout <= 0

    options = { headers: { "Authorization" => "Bearer #{token}", "Accept" => "application/vnd.github+json", "X-GitHub-Api-Version" => "2022-11-28", "Content-Type" => "application/json" }, timeout: effective_timeout }
    options[:body] = body.to_json if body
    options[:query] = query if query
    response = @transport.public_send(method, "#{BASE}#{path}", **options)
    headers = extract_headers(response)
    unless response.success?
      code = response.code.to_i
      if rate_limited_response?(code, headers, response.parsed_response)
        raise Error.new(
          "GitHub rate limit reached; try again later",
          status: code,
          retry_after: parse_retry_after(headers),
          rate_limited: true
        )
      end

      message = case code
      when 401 then "GitHub authorization expired; reconnect the installation"
      when 403, 404, 422 then "GitHub installation cannot access this repository; check selected repositories and reconnect"
      else "GitHub is temporarily unavailable; try again"
      end
      raise Error.new(message, status: code)
    end
    value = response.parsed_response
    raise Error, PROVIDER_ERROR unless value.is_a?(expect)

    include_headers ? [ value, headers ] : value
  rescue Error, BudgetExceeded
    raise
  rescue StandardError
    raise Error, "GitHub is temporarily unavailable; try again"
  end

  def resolve_request_timeout(timeout:, deadline:, monotonic:)
    return timeout unless deadline

    clock = monotonic || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
    remaining = deadline - clock.call
    raise BudgetExceeded, "GitHub request budget exhausted" if remaining <= 0

    clamped = [ remaining, DEFAULT_TIMEOUT.to_f ].min
    timeout ? [ timeout.to_f, clamped ].min : clamped
  end

  def extract_headers(response)
    raw = response.respond_to?(:headers) ? response.headers : nil
    return {} unless raw.respond_to?(:each)

    raw.each_with_object({}) do |(key, value), acc|
      acc[key.to_s.downcase] = value.is_a?(Array) ? value.first.to_s : value.to_s
    end
  end

  def rate_limited_response?(code, headers, parsed_body)
    return true if code == 429
    return false unless code == 403

    return true if headers["x-ratelimit-remaining"].to_s.strip == "0"
    return true if headers["retry-after"].to_s.strip.present?

    parsed_body.is_a?(Hash) && parsed_body["message"].to_s.downcase.include?("rate limit")
  end

  def parse_retry_after(headers)
    raw = headers["retry-after"].to_s.strip
    if raw.match?(/\A\d+\z/)
      seconds = raw.to_i
      return seconds if seconds.positive?
    end

    reset = headers["x-ratelimit-reset"].to_s.strip
    if reset.match?(/\A\d+\z/)
      delta = reset.to_i - @now.call.to_i
      return delta if delta.positive?
    end

    nil
  end

  def has_next_page?(headers)
    headers["link"].to_s.include?('rel="next"')
  end
end
