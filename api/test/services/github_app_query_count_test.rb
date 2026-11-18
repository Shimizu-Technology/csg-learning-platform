require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/query_counter"

class GithubAppQueryCountTest < ActiveSupport::TestCase
  include GithubAppFixtures
  include QueryCounter
  setup { build_github_app_fixture; @cohort.update!(settings: {}) }
  def setting_reads
    capture_queries { yield }.count { |sql| sql.match?(/SELECT.*FROM "school_settings"/i) }
  end
  test "Off cohort batch reads school settings once regardless of learner count outside a request" do
    service = GithubSyncService.new(github_token: "synthetic")
    service.define_singleton_method(:fetch_exercise_files) { |*| { files: [], commit_hash: nil, error: nil } }
    assert_equal 1, setting_reads { service.sync_cohort_module(cohort: @cohort, curriculum_module: @mod) }
    5.times do |n|
      user = User.create!(clerk_id: "query-#{n}", email: "query-#{n}@example.invalid", github_username: "learner-#{n}")
      @cohort.enrollments.create!(user: user, status: :active)
    end
    assert_equal 1, setting_reads { service.sync_cohort_module(cohort: @cohort, curriculum_module: @mod) }
    assert_empty @fake.calls
  end
  test "school App On alone cannot route an unenrolled legacy submission through the App" do
    submission = Submission.create!(user: @student, content_block: @block, repo_url: "https://github.com/app-learner/prework-exercises", commit_sha: "a" * 40)
    service = GithubCheckRunSyncService.new(submission: submission, token: "synthetic", app_client: @fake)
    service.define_singleton_method(:fetch_runs) { |*| { runs: [], error: nil } }
    assert_nil service.call[:error]
    assert_empty @fake.calls
  end
  test "Off check refresh resolves switches once outside a request" do
    submission = @enrollment.submissions.create!(user: @student, content_block: @block, repo_url: "https://github.com/app-learner/prework-exercises", commit_sha: "a" * 40)
    service = GithubCheckRunSyncService.new(submission: submission, token: "synthetic")
    service.define_singleton_method(:fetch_runs) { |*| { runs: [], error: nil } }
    assert_equal 1, setting_reads { assert_nil service.call[:error] }
  end
end
