require "test_helper"
require_relative "../../db/migrate/20261118030000_create_submission_audit_reviews"

class CreateSubmissionAuditReviewsTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "review table rolls back and reapplies with reviewer foreign keys and one decision per block" do
    migration = CreateSubmissionAuditReviews.new
    migration.migrate(:down)
    refute ActiveRecord::Base.connection.table_exists?(:submission_audit_reviews)
    migration.migrate(:up)
    connection = ActiveRecord::Base.connection
    assert connection.indexes(:submission_audit_reviews).any? { |index| index.unique && index.columns == [ "content_block_id" ] }
    reviewer_key = connection.foreign_keys(:submission_audit_reviews).find { |key| key.to_table == "users" }
    assert_equal :nullify, reviewer_key.on_delete
    assert connection.columns(:submission_audit_reviews).find { |column| column.name == "reviewed_by_id" }.null
    assert_equal %w[content_blocks users], connection.foreign_keys(:submission_audit_reviews).map(&:to_table).sort
  ensure
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:submission_audit_reviews)
    ensure
      ActiveRecord::Base.connection_pool.connections.each(&:clear_cache!)
      SubmissionAuditReview.reset_column_information
    end
  end
end
