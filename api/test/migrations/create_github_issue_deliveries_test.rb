require "test_helper"
require Rails.root.join("db/migrate/20261122060000_create_github_issue_deliveries").to_s
require Rails.root.join("db/migrate/20261126140000_add_grading_scale_to_curricula").to_s

class CreateGithubIssueDeliveriesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "additive migration rolls back and reapplies idempotently with constraints and no secrets" do
    migration = CreateGithubIssueDeliveries.new
    before = Cohort.pluck(:id, :settings)

    migration.migrate(:down)
    refute ActiveRecord::Base.connection.table_exists?(:github_issue_deliveries)

    migration.migrate(:up)
    # Idempotent re-run
    migration.migrate(:up)

    connection = ActiveRecord::Base.connection
    assert connection.table_exists?(:github_issue_deliveries)
    column_names = connection.columns(:github_issue_deliveries).map(&:name)
    assert_includes column_names, "claim_token"
    assert_includes column_names, "claimed_until"
    refute column_names.any? { |name| name.match?(/private_key|secret/) }

    indexes = connection.indexes(:github_issue_deliveries)
    assert indexes.any? { |idx| idx.unique && idx.columns == [ "dedupe_token" ] }
    assert indexes.any? { |idx| idx.columns == %w[status next_retry_at] }
    assert indexes.any? { |idx| idx.columns == %w[enrollment_id content_block_id repository_id] }
    assert indexes.any? { |idx| idx.columns == %w[enrollment_id content_block_id claimed_until] }
    assert indexes.any? { |idx| idx.columns == [ "submission_id" ] }

    constraints = connection.check_constraints(:github_issue_deliveries).map(&:name)
    assert_includes constraints, "github_issue_deliveries_action_valid"
    assert_includes constraints, "github_issue_deliveries_grade_valid"
    assert_includes constraints, "github_issue_deliveries_status_valid"
    assert_includes constraints, "github_issue_deliveries_attempts_nonnegative"

    fks = connection.foreign_keys(:github_issue_deliveries).index_by(&:column)
    assert_equal :cascade, fks.fetch("submission_id").on_delete
    assert_equal :cascade, fks.fetch("enrollment_id").on_delete
    assert_equal :cascade, fks.fetch("content_block_id").on_delete
    assert_equal :nullify, fks.fetch("github_repository_binding_id").on_delete

    assert_equal before, Cohort.pluck(:id, :settings)
    assert_equal 0, GithubIssueDelivery.count
  ensure
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:github_issue_deliveries)
      # The recreated table has this migration's constraints; restore the later Pass ones.
      AddGradingScaleToCurricula.new.migrate(:up)
    ensure
      ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
      GithubIssueDelivery.reset_column_information
    end
  end
end
