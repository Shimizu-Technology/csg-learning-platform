require "digest"

# No transport calls. Shared by automated tests and the guarded local QA harness.
class FakeGithubAppClient
  attr_reader :calls, :issues
  attr_accessor :failure, :issue_failure, :repository_owner, :repository_owner_id, :fork, :owner_type,
    :source_text, :commit_sha, :commit_branch, :committed_at, :files_by_name, :workflow_files,
    :timeout_after_create, :on_create_issue, :on_close_issue, :on_repository,
    :on_default_branch_head, :on_files_at_commit, :on_checks,
    :on_find_issue_by_marker, :on_get_issue, :inconclusive_marker_search

  def initialize
    @calls = []
    @issues = {}
    @mutex = Mutex.new
    @next_issue_number = 1
    @next_comment_id = 1
    @repository_owner = "app-learner"
    @repository_owner_id = 24680
    @fork = false
    @owner_type = "User"
    @source_text = "puts 'synthetic source'"
    @commit_sha = "a" * 40
    @commit_branch = "main"
    @committed_at = nil
    @files_by_name = nil
    @workflow_files = {}
    @timeout_after_create = false
    @inconclusive_marker_search = false
  end

  def installation(id, timeout: nil)
    @mutex.synchronize { @calls << [ :installation, id ] }
    raise failure if failure

    { "id" => id.to_i, "app_id" => 12345, "account" => { "id" => 24680, "login" => "app-learner", "type" => "User" }, "repository_selection" => "selected", "permissions" => { "contents" => "read", "checks" => "read", "metadata" => "read", "issues" => "write" } }
  end

  def repository(installation:, full_name:, repository_id: nil, timeout: nil, deadline: nil, monotonic: nil)
    if deadline
      clock = monotonic || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
      raise GithubAppClient::BudgetExceeded, "GitHub request budget exhausted" if deadline - clock.call <= 0
    end
    @mutex.synchronize { @calls << [ :repository, installation.id, full_name, repository_id, timeout ] }
    if @on_repository
      result = @on_repository.call(installation: installation, full_name: full_name, repository_id: repository_id, timeout: timeout)
      return result if result.is_a?(Hash)
    end
    raise failure if failure
    if full_name.end_with?("/unselected")
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 422)
    end
    owner = full_name.start_with?("wrong-owner/") ? "wrong-owner" : repository_owner
    name = full_name.split("/").last
    { "id" => repository_id || (name == "prework-exercises" ? 98765 : 98766), "full_name" => "#{owner}/#{name}", "fork" => (fork || name == "forked-repo"), "owner" => { "id" => (owner == "wrong-owner" || full_name.start_with?("victim-gh/") ? 86420 : repository_owner_id), "login" => owner, "type" => owner_type } }
  end

  def default_branch_head(installation:, repository:, timeout: nil, deadline: nil, monotonic: nil)
    if deadline
      clock = monotonic || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
      raise GithubAppClient::BudgetExceeded, "GitHub request budget exhausted" if deadline - clock.call <= 0
    end
    @mutex.synchronize { @calls << [ :default_branch_head, installation.id, repository.fetch("id"), timeout ] }
    if @on_default_branch_head
      result = @on_default_branch_head.call(installation: installation, repository: repository, timeout: timeout)
      return result if result
    end
    raise failure if failure

    { commit_hash: commit_sha, branch: commit_branch, committed_at: committed_at }
  end

  def files_at_commit(installation:, repository:, sha:, branch:, filenames:, workflow_paths: [], timeout: nil, deadline: nil, monotonic: nil)
    if deadline
      clock = monotonic || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
      raise GithubAppClient::BudgetExceeded, "GitHub request budget exhausted" if deadline - clock.call <= 0
    end
    @mutex.synchronize do
      entry = [ :files_at_commit, installation.id, repository.fetch("id"), sha, filenames ]
      entry << workflow_paths if workflow_paths.any?
      @calls << entry
    end
    if @on_files_at_commit
      result = @on_files_at_commit.call(installation: installation, repository: repository, sha: sha, branch: branch, filenames: filenames, workflow_paths: workflow_paths, timeout: timeout)
      return result if result
    end
    raise failure if failure

    captured_workflows = Array(workflow_paths).each_with_object({}) do |path, hash|
      entry = (@workflow_files || {})[path]
      if entry.nil?
        hash[path] = { "present" => false }
      else
        text = entry.fetch("text", "")
        hash[path] = {
          "present" => true,
          "oid" => entry.fetch("oid", Digest::SHA1.hexdigest("blob #{text.bytesize}\0#{text}")),
          "sha256" => entry.fetch("sha256", Digest::SHA256.hexdigest(text))
        }
      end
    end
    resolved_files = filenames.filter_map do |name|
      if @files_by_name
        text = @files_by_name[name]
        text.nil? ? nil : { "name" => name, "text" => text }
      else
        { "name" => name, "text" => source_text }
      end
    end
    { files: resolved_files, workflow_files: captured_workflows, commit_hash: sha, branch: branch, error: nil }
  end

  def files(installation:, repository:, filenames:, workflow_paths: [], timeout: nil)
    @mutex.synchronize do
      entry = [ :files, installation.id, repository.fetch("id"), filenames ]
      entry << workflow_paths if workflow_paths.any?
      @calls << entry
    end
    raise failure if failure

    captured_workflows = Array(workflow_paths).each_with_object({}) do |path, hash|
      entry = (@workflow_files || {})[path]
      if entry.nil?
        hash[path] = { "present" => false }
      else
        text = entry.fetch("text", "")
        hash[path] = {
          "present" => true,
          "oid" => entry.fetch("oid", Digest::SHA1.hexdigest("blob #{text.bytesize}\0#{text}")),
          "sha256" => entry.fetch("sha256", Digest::SHA256.hexdigest(text))
        }
      end
    end
    { files: filenames.map { |name| { "name" => name, "text" => source_text } }, workflow_files: captured_workflows, commit_hash: commit_sha, branch: commit_branch, error: nil }
  end

  def checks(installation:, repository_id:, full_name:, sha:, page:, timeout: nil, deadline: nil, monotonic: nil)
    if deadline
      clock = monotonic || -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }
      raise GithubAppClient::BudgetExceeded, "GitHub request budget exhausted" if deadline - clock.call <= 0
    end
    @mutex.synchronize { @calls << [ :checks, installation.id, repository_id, full_name, sha, page ] }
    if @on_checks
      result = @on_checks.call(installation: installation, repository_id: repository_id, full_name: full_name, sha: sha, page: page, timeout: timeout)
      return result if result
    end
    raise failure if failure

    { "total_count" => 1, "check_runs" => [ { "id" => 13579, "name" => "synthetic-test", "head_sha" => sha, "status" => "completed", "conclusion" => "success" } ] }
  end

  def find_issue_by_marker(installation:, repository_id:, full_name:, marker:, issue_number: nil, max_pages: GithubAppClient::MARKER_SEARCH_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
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

  def find_issue_by_markers(installation:, repository_id:, full_name:, markers:, issue_number: nil, max_pages: GithubAppClient::MARKER_SEARCH_MAX_PAGES, timeout: nil, deadline: nil, monotonic: nil)
    marker_list = Array(markers)
    @mutex.synchronize { @calls << [ :find_issue_by_marker, installation.id, repository_id, full_name, marker_list, issue_number, timeout ] }
    @on_find_issue_by_marker&.call(installation: installation, repository_id: repository_id, full_name: full_name, markers: marker_list, issue_number: issue_number, timeout: timeout)
    raise issue_failure if issue_failure
    if @inconclusive_marker_search
      raise GithubAppClient::InconclusiveSearchError, "Could not confirm whether GitHub feedback was already posted after checking #{max_pages} pages; inspect the repository before retrying"
    end

    @mutex.synchronize do
      repo_issues = @issues[repository_id] ||= {}
      if issue_number
        issue = repo_issues[issue_number.to_i]
        return nil unless issue

        matched_comment_marker = nil
        issue[:comments].each do |comment|
          matched_comment_marker = marker_list.find { |m| comment[:body].include?(m) }
          break if matched_comment_marker
        end
        if matched_comment_marker
          return issue_hash(issue).merge("matched_comment" => true, "matched_marker" => matched_comment_marker)
        end

        body_marker = marker_list.find { |m| issue[:body].include?(m) }
        return issue_hash(issue).merge("matched_marker" => body_marker) if body_marker

        return nil
      end

      repo_issues.each_value do |issue|
        matched_marker = marker_list.find { |m| issue[:body].include?(m) }
        return issue_hash(issue).merge("matched_marker" => matched_marker) if matched_marker
      end
      nil
    end
  end

  def create_issue(installation:, repository_id:, full_name:, title:, body:, timeout: nil)
    @mutex.synchronize { @calls << [ :create_issue, installation.id, repository_id, full_name, title, body, timeout ] }
    @on_create_issue&.call(installation: installation, repository_id: repository_id, full_name: full_name, title: title, body: body, timeout: timeout)
    raise issue_failure if issue_failure

    issue = @mutex.synchronize do
      num = @next_issue_number
      @next_issue_number += 1
      created = {
        number: num,
        html_url: "https://github.com/#{full_name}/issues/#{num}",
        state: "open",
        title: title,
        body: body,
        comments: []
      }
      (@issues[repository_id] ||= {})[num] = created
      created
    end
    if @timeout_after_create
      @timeout_after_create = false
      raise GithubAppClient::Error, GithubAppClient::PROVIDER_ERROR
    end
    issue_hash(issue)
  end

  def get_issue(installation:, repository_id:, full_name:, issue_number:, timeout: nil)
    @mutex.synchronize { @calls << [ :get_issue, installation.id, repository_id, full_name, issue_number, timeout ] }
    @on_get_issue&.call(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: issue_number, timeout: timeout)
    raise issue_failure if issue_failure

    @mutex.synchronize do
      issue = (@issues[repository_id] || {})[issue_number.to_i]
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 404) unless issue

      issue_hash(issue).merge("title" => issue[:title], "body" => issue[:body])
    end
  end

  def reopen_issue(installation:, repository_id:, full_name:, issue_number:, timeout: nil)
    @mutex.synchronize { @calls << [ :reopen_issue, installation.id, repository_id, full_name, issue_number, timeout ] }
    raise issue_failure if issue_failure

    @mutex.synchronize do
      issue = (@issues[repository_id] || {})[issue_number.to_i]
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 404) unless issue

      issue[:state] = "open"
      issue_hash(issue)
    end
  end

  def add_issue_comment(installation:, repository_id:, full_name:, issue_number:, body:, timeout: nil)
    @mutex.synchronize { @calls << [ :add_issue_comment, installation.id, repository_id, full_name, issue_number, body, timeout ] }
    raise issue_failure if issue_failure

    @mutex.synchronize do
      issue = (@issues[repository_id] || {})[issue_number.to_i]
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 404) unless issue

      comment_id = @next_comment_id
      @next_comment_id += 1
      issue[:comments] << { id: comment_id, body: body }
      { "id" => comment_id, "html_url" => "#{issue[:html_url]}#issuecomment-#{comment_id}" }
    end
  end

  def close_issue(installation:, repository_id:, full_name:, issue_number:, comment: nil, timeout: nil)
    @mutex.synchronize { @calls << [ :close_issue, installation.id, repository_id, full_name, issue_number, comment, timeout ] }
    @on_close_issue&.call(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: issue_number, comment: comment, timeout: timeout)
    raise issue_failure if issue_failure

    if comment.present?
      add_issue_comment(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: issue_number, body: comment, timeout: timeout)
    end
    @mutex.synchronize do
      issue = (@issues[repository_id] || {})[issue_number.to_i]
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 404) unless issue

      issue[:state] = "closed"
      issue_hash(issue)
    end
  end

  private

  def issue_hash(issue)
    { "number" => issue[:number], "html_url" => issue[:html_url], "state" => issue[:state] }
  end
end
