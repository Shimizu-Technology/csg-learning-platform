# No transport calls. Shared by automated tests and the guarded local QA harness.
class FakeGithubAppClient
  attr_reader :calls, :issues
  attr_accessor :failure, :issue_failure, :repository_owner, :repository_owner_id, :fork, :owner_type,
    :timeout_after_create, :on_create_issue, :on_close_issue, :on_repository, :inconclusive_marker_search

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
    @timeout_after_create = false
    @inconclusive_marker_search = false
  end

  def installation(id)
    @mutex.synchronize { @calls << [ :installation, id ] }
    raise failure if failure

    { "id" => id.to_i, "app_id" => 12345, "account" => { "id" => 24680, "login" => "app-learner", "type" => "User" }, "repository_selection" => "selected", "permissions" => { "contents" => "read", "checks" => "read", "metadata" => "read", "issues" => "write" } }
  end

  def repository(installation:, full_name:, repository_id: nil)
    @mutex.synchronize { @calls << [ :repository, installation.id, full_name, repository_id ] }
    @on_repository&.call(installation: installation, full_name: full_name, repository_id: repository_id)
    raise failure if failure
    if full_name.end_with?("/unselected")
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 422)
    end
    owner = full_name.start_with?("wrong-owner/") ? "wrong-owner" : repository_owner
    name = full_name.split("/").last
    { "id" => repository_id || (name == "prework-exercises" ? 98765 : 98766), "full_name" => "#{owner}/#{name}", "fork" => (fork || name == "forked-repo"), "owner" => { "id" => (owner == "wrong-owner" || full_name.start_with?("victim-gh/") ? 86420 : repository_owner_id), "login" => owner, "type" => owner_type } }
  end

  def files(installation:, repository:, filenames:)
    @mutex.synchronize { @calls << [ :files, installation.id, repository.fetch("id"), filenames ] }
    raise failure if failure

    { files: filenames.map { |name| { "name" => name, "text" => "puts 'synthetic source'" } }, commit_hash: "a" * 40, error: nil }
  end

  def checks(installation:, repository_id:, full_name:, sha:, page:)
    @mutex.synchronize { @calls << [ :checks, installation.id, repository_id, full_name, sha, page ] }
    raise failure if failure

    { "total_count" => 1, "check_runs" => [ { "id" => 13579, "name" => "synthetic-test", "head_sha" => sha, "status" => "completed", "conclusion" => "success" } ] }
  end

  def find_issue_by_marker(installation:, repository_id:, full_name:, marker:, issue_number: nil, max_pages: GithubAppClient::MARKER_SEARCH_MAX_PAGES)
    @mutex.synchronize { @calls << [ :find_issue_by_marker, installation.id, repository_id, full_name, marker, issue_number ] }
    raise issue_failure if issue_failure
    if @inconclusive_marker_search
      raise GithubAppClient::InconclusiveSearchError, "Could not confirm whether GitHub feedback was already posted after checking #{max_pages} pages; inspect the repository before retrying"
    end

    @mutex.synchronize do
      repo_issues = @issues[repository_id] ||= {}
      if issue_number
        issue = repo_issues[issue_number.to_i]
        return nil unless issue

        if issue[:comments].any? { |c| c[:body].include?(marker) }
          return issue_hash(issue).merge("matched_comment" => true)
        end
        return issue_hash(issue) if issue[:body].include?(marker)

        return nil
      end

      found = repo_issues.values.find { |issue| issue[:body].include?(marker) }
      found ? issue_hash(found) : nil
    end
  end

  def create_issue(installation:, repository_id:, full_name:, title:, body:)
    @mutex.synchronize { @calls << [ :create_issue, installation.id, repository_id, full_name, title, body ] }
    @on_create_issue&.call(installation: installation, repository_id: repository_id, full_name: full_name, title: title, body: body)
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

  def get_issue(installation:, repository_id:, full_name:, issue_number:)
    @mutex.synchronize { @calls << [ :get_issue, installation.id, repository_id, full_name, issue_number ] }
    raise issue_failure if issue_failure

    @mutex.synchronize do
      issue = (@issues[repository_id] || {})[issue_number.to_i]
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 404) unless issue

      issue_hash(issue).merge("title" => issue[:title], "body" => issue[:body])
    end
  end

  def reopen_issue(installation:, repository_id:, full_name:, issue_number:)
    @mutex.synchronize { @calls << [ :reopen_issue, installation.id, repository_id, full_name, issue_number ] }
    raise issue_failure if issue_failure

    @mutex.synchronize do
      issue = (@issues[repository_id] || {})[issue_number.to_i]
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 404) unless issue

      issue[:state] = "open"
      issue_hash(issue)
    end
  end

  def add_issue_comment(installation:, repository_id:, full_name:, issue_number:, body:)
    @mutex.synchronize { @calls << [ :add_issue_comment, installation.id, repository_id, full_name, issue_number, body ] }
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

  def close_issue(installation:, repository_id:, full_name:, issue_number:, comment: nil)
    @mutex.synchronize { @calls << [ :close_issue, installation.id, repository_id, full_name, issue_number, comment ] }
    @on_close_issue&.call(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: issue_number, comment: comment)
    raise issue_failure if issue_failure

    if comment.present?
      add_issue_comment(installation: installation, repository_id: repository_id, full_name: full_name, issue_number: issue_number, body: comment)
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
