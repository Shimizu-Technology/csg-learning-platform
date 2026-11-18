require "jwt"
require "openssl"

# The only App HTTP boundary. Provider failures never include response bodies,
# headers, tokens or key material in errors. Cache tokens in this process only.
class GithubAppClient
  class Error < StandardError
    attr_reader :status
    def initialize(message, status: nil)
      @status = status
      super(message)
    end
  end

  PROVIDER_ERROR = "GitHub is temporarily unavailable; try again".freeze
  BASE = "https://api.github.com".freeze
  TOKEN_CACHE = ActiveSupport::Cache::MemoryStore.new(size: 1.megabyte)

  def initialize(transport: HTTParty, cache: TOKEN_CACHE, credentials: GithubAppCredentials, now: -> { Time.current })
    @transport, @cache, @credentials, @now = transport, cache, credentials, now
  end

  def installation(installation_id)
    result = request(:get, "/app/installations/#{Integer(installation_id)}", token: app_jwt)
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

  def repository(installation:, full_name:, repository_id: nil)
    # Restrict a second token to this numeric repo. GitHub rejects repository_ids
    # outside this installation, including readable public but unselected repos.
    path = repository_id ? "/repositories/#{Integer(repository_id)}" : "/repos/#{full_name}"
    repo = installation_request(installation, :get, path, repository_id: repository_id)
    id = Integer(repo.fetch("id"))
    unless positive_id?(id) && repo.fetch("full_name").is_a?(String) && repo.fetch("owner").is_a?(Hash) && positive_id?(repo.fetch("owner").fetch("id")) &&
        repo.fetch("owner").fetch("login").is_a?(String) && %w[User Organization].include?(repo.fetch("owner").fetch("type")) && [ true, false ].include?(repo.fetch("fork"))
      raise Error, PROVIDER_ERROR
    end
    installation_token(installation, repository_id: id)
    repo
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def files(installation:, repository:, filenames:)
    fragments = filenames.each_with_index.map do |filename, index|
      "file_#{index}: object(expression: #{"HEAD:#{filename}".to_json}) { ... on Blob { text } }"
    end.join("\n")
    owner, name = repository.fetch("full_name").split("/")
    query = "query($owner: String!, $name: String!) { repository(owner: $owner, name: $name, followRenames: false) { fullDatabaseId defaultBranchRef { target { ... on Commit { oid } } } #{fragments} } }"
    result = installation_request(installation, :post, "/graphql", repository_id: repository.fetch("id"), body: { query: query, variables: { owner: owner, name: name } })
    repo = result.fetch("data").fetch("repository")
    raise Error, "GitHub repository is unavailable; verify access again" unless repo && repo.fetch("fullDatabaseId").to_i == repository.fetch("id").to_i && result["errors"].blank?

    branch = repo.fetch("defaultBranchRef")
    files = filenames.each_with_index.filter_map do |filename, index|
      blob = repo.fetch("file_#{index}")
      text = blob&.fetch("text", nil)
      raise Error, PROVIDER_ERROR unless text.nil? || text.is_a?(String)

      { "name" => filename, "text" => text } if text.present?
    end
    { files: files, commit_hash: branch&.fetch("target")&.fetch("oid"), error: nil }
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  def checks(installation:, repository_id:, full_name:, sha:, page:)
    raise Error, "Invalid submission commit SHA" unless sha.to_s.match?(/\A[a-fA-F0-9]{6,64}\z/)

    result = installation_request(installation, :get, "/repos/#{full_name}/commits/#{sha}/check-runs", repository_id: repository_id, query: { filter: "latest", per_page: 100, page: page })
    unless result.fetch("check_runs").is_a?(Array) && result.fetch("total_count").is_a?(Integer) && result["total_count"] >= 0
      raise Error, PROVIDER_ERROR
    end
    result
  rescue KeyError, TypeError, ArgumentError, NoMethodError
    raise Error, PROVIDER_ERROR
  end

  private

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

  def installation_token(installation, repository_id: nil, refresh: false)
    key = token_key(installation, repository_id)
    @cache.delete(key) if refresh
    cached = @cache.read(key)
    return cached if cached

    payload = repository_id ? { repository_ids: [ Integer(repository_id) ] } : {}
    result = request(:post, "/app/installations/#{installation.installation_id}/access_tokens", token: app_jwt, body: payload)
    ttl = [ Time.iso8601(result.fetch("expires_at")) - @now.call - 60, 5.minutes.to_i ].min
    raise Error, "GitHub returned an expired installation token" unless ttl.positive? && result.fetch("token").is_a?(String) && result["token"].present?

    @cache.write(key, result.fetch("token"), expires_in: ttl)
    result.fetch("token")
  end

  def installation_request(installation, method, path, repository_id: nil, **options)
    attempts = 0
    begin
      token = installation_token(installation, repository_id: repository_id, refresh: attempts.positive?)
      request(method, path, token: token, **options)
    rescue Error => error
      if error.status == 401 && attempts.zero?
        attempts += 1
        retry
      end
      raise
    end
  end

  def request(method, path, token:, body: nil, query: nil)
    options = { headers: { "Authorization" => "Bearer #{token}", "Accept" => "application/vnd.github+json", "X-GitHub-Api-Version" => "2022-11-28", "Content-Type" => "application/json" }, timeout: 10 }
    options[:body] = body.to_json if body
    options[:query] = query if query
    response = @transport.public_send(method, "#{BASE}#{path}", **options)
    unless response.success?
      message = case response.code.to_i
      when 401 then "GitHub authorization expired; reconnect the installation"
      when 403, 404, 422 then "GitHub installation cannot access this repository; check selected repositories and reconnect"
      when 429 then "GitHub rate limit reached; try again later"
      else "GitHub is temporarily unavailable; try again"
      end
      raise Error.new(message, status: response.code.to_i)
    end
    value = response.parsed_response
    raise Error, PROVIDER_ERROR unless value.is_a?(Hash)

    value
  rescue Error
    raise
  rescue StandardError
    raise Error, "GitHub is temporarily unavailable; try again"
  end
end
