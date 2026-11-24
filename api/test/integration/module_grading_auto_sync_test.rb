require "test_helper"
require_relative "../support/github_app_fixtures"

# Module grading says "GitHub also syncs automatically every hour" only when the hourly
# reconciliation would really pick this cohort's module up (UX-1 review).
class ModuleGradingAutoSyncTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures

  setup do
    build_github_app_fixture
    SchoolSetting.current.update!(features: { github_app: true, github_reconciliation: true })
    @cohort.update!(settings: { features: { github_app: true, github_reconciliation: true } })
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
  end

  test "an active opted-in cohort with a verified binding is synced hourly" do
    assert_equal true, auto_sync?
  end

  test "a binding for this module still counts, one for another module does not" do
    other = @curriculum.modules.create!(name: "Other module", position: 1)
    @binding.update_columns(curriculum_module_id: other.id)
    assert_equal false, auto_sync?
    @binding.update_columns(curriculum_module_id: @mod.id)
    assert_equal true, auto_sync?
  end

  test "no hourly promise without a verified binding" do
    @binding.update_columns(verification_state: "pending")
    assert_equal false, auto_sync?
  end

  test "no hourly promise once the cohort has completed" do
    @cohort.update_columns(status: Cohort.statuses.fetch("completed"))
    assert_equal false, auto_sync?
  end

  test "no hourly promise when the cohort turns GitHub sync off" do
    @cohort.update!(settings: { features: { github_app: true, github_reconciliation: true, github_sync: false } })
    assert_equal false, auto_sync?
  end

  test "no hourly promise when the school has reconciliation off" do
    SchoolSetting.current.update!(features: { github_app: true })
    assert_equal false, auto_sync?
  end

  private

  def auto_sync?
    with_app_provider do
      as_app_user(@instructor) do
        get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions", headers: app_headers
      end
    end
    assert_response :success
    response.parsed_body.fetch("github_auto_sync")
  end
end
