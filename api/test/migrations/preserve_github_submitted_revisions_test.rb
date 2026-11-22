require "test_helper"
require Rails.root.join("db/migrate/20261122080000_preserve_github_submitted_revisions").to_s
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"

class PreserveGithubSubmittedRevisionsTest < ActiveSupport::TestCase
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  self.use_transactional_tests = false

  test "additive nullable provenance rolls back and reapplies without backfilling historical work" do
    migration = PreserveGithubSubmittedRevisions.new
    previous_features = SchoolSetting.current.features.deep_dup
    build_github_app_fixture
    @enrollment.submissions.create!(user: @student, content_block: @block, text: "Historical graded source", grade: :B,
      feedback: "Preserve original feedback", commit_sha: "historical-sha", num_submissions: 3)
    before = Submission.pluck(:id, :text, :grade, :feedback, :commit_sha, :updated_at)
    migration.migrate(:down)
    refute ActiveRecord::Base.connection.column_exists?(:submissions, :github_revision)
    migration.migrate(:up)
    clear_pooled_caches
    column = ActiveRecord::Base.connection.columns(:submissions).find { |row| row.name == "github_revision" }
    assert column.null
    assert_nil column.default
    assert_equal before, Submission.pluck(:id, :text, :grade, :feedback, :commit_sha, :updated_at)
    assert_equal 0, Submission.where.not(github_revision: nil).count
  ensure
    migration&.migrate(:up) unless ActiveRecord::Base.connection.column_exists?(:submissions, :github_revision)
    clear_pooled_caches
    @enrollment&.submissions&.destroy_all
    @cohort&.destroy!
    @curriculum&.destroy!
    delete_test_users(@admin, @instructor, @student, @other)
    SchoolSetting.current.update!(features: previous_features) if previous_features
  end

  private

  def clear_pooled_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    Submission.reset_column_information
  end
end
