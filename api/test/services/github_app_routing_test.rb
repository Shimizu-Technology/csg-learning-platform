require "test_helper"
require_relative "../support/github_app_fixtures"

class GithubAppRoutingTest < ActiveSupport::TestCase
  include GithubAppFixtures
  setup { build_github_app_fixture }

  test "opted in sync uses verified numeric binding with no legacy token and module override" do
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    service = GithubSyncService.new(github_token: nil, app_client: @fake)
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_empty result[:errors]
    assert_equal 1, result[:synced]
    submission = @enrollment.submissions.sole
    assert_equal "a" * 40, submission.commit_sha
    assert_match "app-learner/prework-exercises/blob", submission.github_code_url
    override = @enrollment.github_repository_bindings.create!(curriculum_module: @mod, github_app_installation: @installation, full_name: "app-learner/module-repo")
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal 0, result[:synced]
    assert_match "verification required", result[:errors].join
    GithubRepositoryAccess.new(override, client: @fake).verify!
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_empty result[:errors]
    assert_match "app-learner/module-repo/blob", submission.reload.github_code_url
  end

  test "checks use exact submitted SHA through App only when repository matches binding" do
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    submission = Submission.create!(enrollment: @enrollment, user: @student, content_block: @block, repo_url: "https://github.com/app-learner/prework-exercises", commit_sha: "b" * 40)
    service = GithubCheckRunSyncService.new(submission: submission, token: nil, app_client: @fake)
    result = service.call
    assert_nil result[:error]
    assert_equal "b" * 40, result[:check_runs].sole.head_sha
    assert @fake.calls.any? { |call| call.first == :checks && call[2] == 98765 && call[4] == "b" * 40 }
    submission.update!(repo_url: "https://github.com/wrong-owner/other")
    @fake.calls.clear
    assert_match "does not match", service.call[:error]
    assert_empty @fake.calls
  end

  test "unverified revoked transferred and changed identities cannot sync" do
    service = GithubSyncService.new(github_token: "must-not-fall-back", app_client: @fake)
    assert_equal 0, service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)[:synced]
    assert_empty @fake.calls
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    @fake.repository_owner = "transferred-owner"
    assert_equal 0, service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)[:synced]
    assert_equal "failed", @binding.reload.verification_state
    @fake.repository_owner = "app-learner"
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    @student.record_verified_github_identity!(id: "24680", login: "changed-learner")
    @fake.calls.clear
    assert_equal 0, service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)[:synced]
    assert_empty @fake.calls
    @student.record_verified_github_identity!(id: "24680", login: "app-learner")
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    @fake.failure = GithubAppClient::Error.new("Repository access revoked", status: 403)
    assert_equal 0, service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)[:synced]
    assert_equal "failed", @binding.reload.verification_state
    assert_empty @enrollment.submissions
  end

  test "concurrent rebind cannot inherit verification or a failure for the previous repository" do
    binding = @binding
    @fake.define_singleton_method(:repository) do |**|
      GithubRepositoryBinding.find(binding.id).update!(full_name: "app-learner/replacement", verification_state: "pending")
      { "id" => 98765, "full_name" => "app-learner/prework-exercises", "owner" => { "login" => "app-learner", "type" => "User" } }
    end
    assert_raises(GithubRepositoryAccess::BindingChanged) { GithubRepositoryAccess.new(@binding, client: @fake).verify! }
    assert_equal "pending", @binding.reload.verification_state
    assert_equal "app-learner/replacement", @binding.full_name
    assert_nil @binding.repository_id
    assert_nil @binding.verified_at
  end

  test "direct verification while App gate is Off makes no provider calls or writes" do
    @cohort.update!(settings: {})
    @binding.enrollment = @enrollment
    @enrollment.cohort = @cohort
    before = @binding.attributes
    assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding, client: @fake).verify! }
    assert_empty @fake.calls
    assert_equal before, @binding.reload.attributes
  end

  test "Off cohort uses byte identical legacy request and response even with stale App binding" do
    @cohort.update!(settings: { features: { github_app: false } })
    expected = { files: [ { "name" => "111.rb", "text" => "puts 'legacy'" } ], commit_hash: "legacy-sha", error: nil }
    calls = []
    response = Struct.new(:parsed_response, :code) { def success? = true }.new({ "data" => { "repository" => { "defaultBranchRef" => { "target" => { "oid" => "legacy-sha" } }, "file_0" => { "text" => "puts 'legacy'" } } } }, 200)
    original = HTTParty.method(:post)
    HTTParty.define_singleton_method(:post) { |url, **options| calls << [ url, options ]; response }
    service = GithubSyncService.new(github_token: "legacy-synthetic-token", app_client: @fake)
    # The curriculum-copy concurrency suite prepends its own local provider.
    # Bind the actual legacy method here to assert its HTTP bytes independently.
    legacy_fetch = GithubSyncService.instance_method(:fetch_exercise_files)
    legacy_fetch = legacy_fetch.super_method until legacy_fetch.owner == GithubSyncService
    service.define_singleton_method(:fetch_exercise_files, legacy_fetch.bind(service))
    result = service.sync_student(user: @student, cohort: @cohort, curriculum_module: @mod)
    assert_equal({ synced: 1, errors: [] }, result)
    assert_empty @fake.calls
    assert_equal "https://api.github.com/graphql", calls.sole.first
    assert_equal({ "Authorization" => "Bearer legacy-synthetic-token", "Content-Type" => "application/json" }, calls.sole.last.fetch(:headers))
    assert_equal 15, calls.sole.last.fetch(:timeout)
    assert_equal({ "owner" => "app-learner", "name" => "prework-exercises" }, JSON.parse(calls.sole.last.fetch(:body)).fetch("variables"))
    assert_equal expected[:files].sole.fetch("text"), @enrollment.submissions.sole.text
    assert_equal "legacy-sha", @enrollment.submissions.sole.commit_sha
  ensure
    HTTParty.define_singleton_method(:post, original) if original
  end
end
