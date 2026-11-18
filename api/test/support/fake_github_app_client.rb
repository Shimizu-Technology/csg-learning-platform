# No transport calls. Shared by automated tests and the guarded local QA harness.
class FakeGithubAppClient
  attr_reader :calls
  attr_accessor :failure, :repository_owner

  def initialize
    @calls = []
    @repository_owner = "app-learner"
  end

  def installation(id)
    @calls << [ :installation, id ]
    raise failure if failure

    { "id" => id.to_i, "app_id" => 12345, "account" => { "id" => 24680, "login" => "synthetic-school", "type" => "Organization" }, "repository_selection" => "selected", "permissions" => { "contents" => "read", "checks" => "read", "metadata" => "read" } }
  end

  def repository(installation:, full_name:, repository_id: nil)
    @calls << [ :repository, installation.id, full_name, repository_id ]
    raise failure if failure
    if full_name.end_with?("/unselected")
      raise GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 422)
    end
    owner = full_name.start_with?("wrong-owner/") ? "wrong-owner" : repository_owner
    name = full_name.split("/").last
    { "id" => repository_id || (name == "prework-exercises" ? 98765 : 98766), "full_name" => "#{owner}/#{name}", "owner" => { "login" => owner, "type" => "User" } }
  end

  def files(installation:, repository:, filenames:)
    @calls << [ :files, installation.id, repository.fetch("id"), filenames ]
    raise failure if failure

    { files: filenames.map { |name| { "name" => name, "text" => "puts 'synthetic source'" } }, commit_hash: "a" * 40, error: nil }
  end

  def checks(installation:, repository_id:, full_name:, sha:, page:)
    @calls << [ :checks, installation.id, repository_id, full_name, sha, page ]
    raise failure if failure

    { "total_count" => 1, "check_runs" => [ { "id" => 13579, "name" => "synthetic-test", "head_sha" => sha, "status" => "completed", "conclusion" => "success" } ] }
  end
end
