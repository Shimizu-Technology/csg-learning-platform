require "test_helper"
require_relative "../support/github_app_fixtures"

class GithubReconciliationBindingStatusTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures

  setup do
    @now = Time.utc(2026, 11, 22, 12, 0, 0)
    travel_to @now
    build_github_app_fixture
    SchoolSetting.current.update!(features: { "github_app" => true, "github_reconciliation" => true })
    @cohort.update!(settings: { "features" => { "github_app" => true, "github_reconciliation" => true } })
    @binding.update!(
      repository_id: 98765,
      github_user_id: "24680",
      github_username: "app-learner",
      verification_state: "verified",
      verified_at: @now - 10.minutes,
      checked_at: @now - 10.minutes
    )
  end

  teardown do
    travel_back
  end

  test "staff binding status exposes read-only reconciliation fields while student view omits internal state, and rebind clears stale state" do
    # Before reconciliation runs: admin sees idle defaults; student does not see reconciliation keys.
    as_app_user(@admin) do
      get bindings_path, headers: app_headers
      assert_response :success
      row = response.parsed_body.fetch("bindings").sole
      assert_equal "idle", row["last_status"]
      assert_nil row["last_reconciled_at"]
      assert_nil row["last_error"]
      assert_nil row["next_reconcile_at"]
    end

    as_app_user(@student) do
      get bindings_path, headers: app_headers
      assert_response :success
      row = response.parsed_body.fetch("bindings").sole
      refute row.key?("last_status")
      refute row.key?("last_reconciled_at")
      refute row.key?("last_error")
      refute row.key?("next_reconcile_at")
    end

    # After reconciliation succeeds: admin sees populated timestamps and status.
    @fake.on_checks = ->(**) { { "total_count" => 0, "check_runs" => [] } }
    GithubReconciliationService.new(client: @fake).call(now: @now)

    as_app_user(@admin) do
      get bindings_path, headers: app_headers
      assert_response :success
      row = response.parsed_body.fetch("bindings").sole
      assert_equal "ok", row["last_status"]
      assert_not_nil row["last_reconciled_at"]
      assert_nil row["last_error"]
      assert_not_nil row["next_reconcile_at"]
    end

    # Explicit rebind clears stale reconciliation state.
    as_app_user(@admin) do
      post bindings_path,
        params: { github_app_installation_id: @installation.id, full_name: "app-learner/new-prework" },
        headers: app_headers,
        as: :json
      assert_response :success
      row = response.parsed_body.fetch("binding")
      assert_equal "idle", row["last_status"]
      assert_nil row["last_reconciled_at"]
      assert_nil GithubReconciliationState.find_by(github_repository_binding_id: @binding.id)
    end
  end

  test "manual staff Sync GitHub and Refresh checks continue working unchanged alongside reconciliation" do
    with_app_provider do
      as_app_user(@admin) do
        post "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/sync_github/#{@student.id}",
          headers: app_headers,
          as: :json
        assert_response :success
        assert_equal 1, response.parsed_body.fetch("synced")

        submission = @enrollment.submissions.sole
        post "/api/v1/submissions/#{submission.id}/github_checks",
          headers: app_headers,
          as: :json
        assert_response :success
        assert_equal 1, response.parsed_body.dig("github_checks", "summary", "passed")
      end
    end
  end
end
