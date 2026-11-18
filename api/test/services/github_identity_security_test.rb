require "test_helper"
require_relative "../support/github_app_fixtures"

class GithubIdentitySecurityTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  setup { build_github_app_fixture }

  test "self-entered victim login cannot discover bind verify or sync a classmate repository" do
    @student.update_columns(github_user_id: nil, github_verified_login: nil, github_verified_at: nil, github_username: "victim-gh")
    victim = @installation.dup
    victim.assign_attributes(installation_id: 789, account_id: 86420, account_login: "victim-gh")
    victim.save!
    as_app_user(@student) do
      get bindings_path, headers: app_headers
      assert_response :success
      assert_empty response.parsed_body.fetch("installations")
      post bindings_path, headers: app_headers, params: { github_app_installation_id: victim.id, full_name: "victim-gh/prework-exercises" }, as: :json
      assert_response :not_found
    end
    @binding.update!(github_app_installation: victim, full_name: "victim-gh/prework-exercises")
    assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding, client: @fake).verify! }
    result = GithubSyncService.new(github_token: nil, app_client: @fake).sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal 0, result[:synced]
    assert_empty @enrollment.submissions
    assert_empty @fake.calls
  end

  test "verified learners see only their own personal installations" do
    [ [ 789, 86420, "User" ], [ 790, 24680, "Organization" ] ].each do |installation_id, account_id, type|
      @cohort.github_app_installations.create!(@installation.attributes.except("id", "created_at", "updated_at").merge("installation_id" => installation_id, "account_id" => account_id, "account_type" => type))
    end
    as_app_user(@student) { get bindings_path, headers: app_headers }
    assert_response :success
    assert_equal [ @installation.id ], response.parsed_body.fetch("installations").map { |row| row.fetch("id") }
  end

  test "renamed account impersonation cannot pass by reusing a login with a different numeric id" do
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    @student.record_verified_github_identity!(id: "24680", login: "renamed-learner")
    @fake.repository_owner = "renamed-learner"
    @fake.repository_owner_id = 86420
    @binding.reload.update!(full_name: "renamed-learner/prework-exercises")
    error = assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding, client: @fake).verify! }
    assert_match "verified GitHub identity", error.message
    @installation.update!(account_id: 86420, account_login: "renamed-learner")
    assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding.reload, client: @fake).verify! }
    assert_empty @enrollment.submissions
  end

  test "forks and organization repositories are refused and do not import source" do
    [ :fork, :owner_type ].each do |field|
      @fake.fork = field == :fork
      @fake.owner_type = field == :owner_type ? "Organization" : "User"
      error = assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding.reload, client: @fake).verify! }
      assert_match(field == :fork ? "Forked" : "verified GitHub identity", error.message)
      assert_equal "failed", @binding.reload.verification_state
      assert_nil @binding.verified_at
      assert_equal 0, GithubSyncService.new(github_token: nil, app_client: @fake).sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)[:synced]
      assert_not @fake.calls.any? { |call| call.first == :files }
    end
  end

  test "binding duplicate index race becomes a recoverable conflict" do
    original = GithubRepositoryBinding.instance_method(:update!)
    GithubRepositoryBinding.define_method(:update!) { |*| raise ActiveRecord::RecordNotUnique, "synthetic concurrent insert" }
    as_app_user(@student) do
      post bindings_path, headers: app_headers, params: { github_app_installation_id: @installation.id, full_name: @binding.full_name }, as: :json
      assert_response :conflict
      assert_equal "Repository binding changed while saving. Reload and try again.", response.parsed_body.fetch("error")
    end
    assert_equal 1, @enrollment.github_repository_bindings.count
  ensure
    GithubRepositoryBinding.define_method(:update!, original) if original
  end
end
