require "test_helper"
require Rails.root.join("db/migrate/20261122050000_create_github_webhook_deliveries").to_s

class CreateGithubWebhookDeliveriesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "additive migration rolls back, reapplies idempotently, and enforces SQL constraints without secrets" do
    migration = CreateGithubWebhookDeliveries.new
    before = Cohort.pluck(:id, :settings)

    migration.migrate(:down)
    connection = ActiveRecord::Base.connection
    refute connection.table_exists?(:github_webhook_deliveries)
    refute connection.column_exists?(:submissions, :github_repository_id)
    refute connection.column_exists?(:github_check_runs, :check_suite_id)

    migration.migrate(:up)
    # Re-running up is idempotent.
    migration.migrate(:up)

    assert connection.table_exists?(:github_webhook_deliveries)
    assert connection.column_exists?(:submissions, :github_repository_id)
    assert connection.column_exists?(:github_check_runs, :check_suite_id)
    refute connection.columns(:github_webhook_deliveries).any? { |column| column.name.match?(/private_key|secret|token/) }

    indexes = connection.indexes(:github_webhook_deliveries)
    assert indexes.any? { |index| index.unique && index.columns == [ "delivery_id" ] }
    assert indexes.any? { |index| index.columns == %w[processing_state received_at] }
    assert indexes.any? { |index| index.columns == %w[repository_id head_sha] }

    checks = connection.check_constraints(:github_webhook_deliveries).map(&:name)
    assert_includes checks, "github_webhook_deliveries_processing_state_valid"
    assert_includes checks, "github_webhook_deliveries_attempts_nonnegative"

    # Exercise PostgreSQL CHECK constraints directly, bypassing ActiveRecord validations.
    now = Time.current
    bad_attempts = assert_raises(ActiveRecord::StatementInvalid) do
      GithubWebhookDelivery.insert_all!([ {
        delivery_id: "sql-check-attempts",
        event: "check_run",
        processing_state: "pending",
        attempts: -1,
        payload: {},
        received_at: now,
        created_at: now,
        updated_at: now
      } ])
    end
    assert_match(/github_webhook_deliveries_attempts_nonnegative/, bad_attempts.message)

    bad_state = assert_raises(ActiveRecord::StatementInvalid) do
      GithubWebhookDelivery.insert_all!([ {
        delivery_id: "sql-check-state",
        event: "check_run",
        processing_state: "bogus",
        attempts: 0,
        payload: {},
        received_at: now,
        created_at: now,
        updated_at: now
      } ])
    end
    assert_match(/github_webhook_deliveries_processing_state_valid/, bad_state.message)

    assert_equal before, Cohort.pluck(:id, :settings)
    assert_equal 0, GithubWebhookDelivery.count
  ensure
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:github_webhook_deliveries) &&
        ActiveRecord::Base.connection.column_exists?(:submissions, :github_repository_id) &&
        ActiveRecord::Base.connection.column_exists?(:github_check_runs, :check_suite_id)
    ensure
      ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
      [ GithubWebhookDelivery, Submission, GithubCheckRun ].each(&:reset_column_information)
    end
  end
end
