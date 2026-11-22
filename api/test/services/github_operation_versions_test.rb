require "test_helper"
require_relative "../support/github_app_fixtures"

class GithubOperationVersionsTest < ActiveSupport::TestCase
  include GithubAppFixtures
  setup { build_github_app_fixture }

  test "an older connection failure cannot undo reconnect and successful verification" do
    old = GithubAppInstallation.find(@installation.id)
    generation, state = old.connection_generation, old.connection_state
    GithubAppInstallation.find(@installation.id).update!(connection_state: "connected", checked_at: Time.current)
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    before = @binding.reload.attributes
    refute old.fail_connection!("Old unauthorized result", expected_generation: generation, expected_state: state)
    assert_equal "connected", @installation.reload.connection_state
    assert_equal before, @binding.reload.attributes
  end

  test "successful verification advances connection generation even with a frozen clock" do
    freeze_time do
      first = @installation.reload.connection_generation
      GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
      second = @installation.reload.connection_generation
      refute_equal first, second
      refute @installation.fail_connection!("Old 401", expected_generation: first, expected_state: "connected")
      assert_equal "verified", @binding.reload.verification_state
    end
  end

  test "current connection failures invalidate the installation and bindings together" do
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    generation = @installation.reload.connection_generation
    assert @installation.fail_connection!("Current unauthorized result", expected_generation: generation, expected_state: "connected")
    assert_equal "failed", @installation.reload.connection_state
    assert_equal "failed", @binding.reload.verification_state
    assert_nil @binding.verified_at
  end

  [ "pending", "verified" ].each do |state|
    test "old repository failure cannot invalidate a #{state} replacement through check rescue" do
      GithubRepositoryAccess.new(@binding, client: @fake).verify!
      submission = @enrollment.submissions.create!(user: @student, content_block: @block, repo_url: "https://github.com/app-learner/prework-exercises", commit_sha: "a" * 40)
      binding_id = @binding.id
      replacement = nil
      @fake.define_singleton_method(:repository) do |**|
        row = GithubRepositoryBinding.find(binding_id)
        row.update!(full_name: "app-learner/replacement", verification_state: state, verified_at: state == "verified" ? Time.current : nil, updated_at: 1.second.from_now)
        replacement = row.attributes
        raise GithubAppClient::Error.new("Old provider failure", status: 401)
      end
      result = GithubCheckRunSyncService.new(submission: submission, token: nil, app_client: @fake).call
      assert_match "Old provider failure", result[:error]
      assert_equal replacement, @binding.reload.attributes
      assert_equal "connected", @installation.reload.connection_state
    end

    test "old check HTTP failure cannot invalidate a #{state} replacement" do
      GithubRepositoryAccess.new(@binding, client: @fake).verify!
      submission = @enrollment.submissions.create!(user: @student, content_block: @block, repo_url: "https://github.com/app-learner/prework-exercises", commit_sha: "a" * 40)
      binding_id = @binding.id
      replacement = nil
      @fake.define_singleton_method(:checks) do |**|
        row = GithubRepositoryBinding.find(binding_id)
        row.update!(full_name: "app-learner/replacement", verification_state: state, verified_at: state == "verified" ? Time.current : nil, updated_at: 1.second.from_now)
        replacement = row.attributes
        raise GithubAppClient::Error.new("Old checks failure", status: 403)
      end
      result = GithubCheckRunSyncService.new(submission: submission, token: nil, app_client: @fake).call
      assert_match "Old checks failure", result[:error]
      assert_equal replacement, @binding.reload.attributes
    end
  end

  test "unchanged bindings still record current provider failures" do
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    submission = @enrollment.submissions.create!(user: @student, content_block: @block, repo_url: "https://github.com/app-learner/prework-exercises", commit_sha: "a" * 40)
    @fake.define_singleton_method(:checks) { |**| raise GithubAppClient::Error.new("Current checks failure", status: 403) }
    assert_match "Current checks failure", GithubCheckRunSyncService.new(submission: submission, token: nil, app_client: @fake).call[:error]
    assert_equal "failed", @binding.reload.verification_state
    assert_equal "connected", @installation.reload.connection_state
  end

  test "a stale unverified user instance cannot overwrite newly committed proof" do
    @student.update_columns(github_user_id: nil, github_verified_login: nil, github_verified_at: nil)
    stale = User.find(@student.id)
    User.find(@student.id).record_verified_github_identity!(id: "24680", login: "proven-login")
    stale.update!(github_username: "victim-login", first_name: "Other edit")
    assert_equal "proven-login", @student.reload.github_username
    assert_equal "24680", @student.github_user_id
    assert_equal "Other edit", @student.first_name
    assert_match "skipped this change", stale.github_username_warning
  end

  test "ordinary unverified username edits still work" do
    @student.update_columns(github_user_id: nil, github_verified_login: nil, github_verified_at: nil)
    User.find(@student.id).update!(github_username: "new-unverified-login")
    assert_equal "new-unverified-login", @student.reload.github_username
    assert_nil @student.github_user_id
  end

  test "transient repository read errors preserve verified binding state while true auth failures still fail it" do
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    assert_equal "verified", @binding.reload.verification_state

    [
      GithubAppClient::Error.new(GithubAppClient::PROVIDER_ERROR),
      GithubAppClient::Error.new(GithubAppClient::PROVIDER_ERROR, status: 503),
      GithubAppClient::Error.new("GitHub rate limit reached; try again later", status: 429, retry_after: 60, rate_limited: true),
      GithubAppClient::Error.new("GitHub rate limit reached; try again later", status: 403, retry_after: 90, rate_limited: true)
    ].each do |transient_error|
      @fake.failure = transient_error
      assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding.reload, client: @fake).repository! }
      assert_equal "verified", @binding.reload.verification_state
      assert_nil @binding.failure_reason
    end

    # Recovery works immediately without re-verification
    @fake.failure = nil
    repo = GithubRepositoryAccess.new(@binding.reload, client: @fake).repository!
    assert_equal 98765, repo.fetch("id")
    assert_equal "verified", @binding.reload.verification_state

    # Non-rate-limit 403 still marks the binding failed
    @fake.failure = GithubAppClient::Error.new("GitHub installation cannot access this repository; check selected repositories and reconnect", status: 403)
    assert_raises(GithubAppClient::Error) { GithubRepositoryAccess.new(@binding.reload, client: @fake).repository! }
    assert_equal "failed", @binding.reload.verification_state
  end
end
