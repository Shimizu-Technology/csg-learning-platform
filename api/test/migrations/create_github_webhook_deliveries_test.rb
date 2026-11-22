require "test_helper"
require Rails.root.join("db/migrate/20261122050000_create_github_webhook_deliveries").to_s

class CreateGithubWebhookDeliveriesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "additive migration rolls back, reapplies idempotently, and enforces constraints without secrets" do
    migration = CreateGithubWebhookDeliveries.new
    before = Cohort.pluck(:id, :settings)

    migration.migrate(:down)
    refute ActiveRecord::Base.connection.table_exists?(:github_webhook_deliveries)

    migration.migrate(:up)
    # Re-running up is idempotent.
    migration.migrate(:up)

    connection = ActiveRecord::Base.connection
    assert connection.table_exists?(:github_webhook_deliveries)
    refute connection.columns(:github_webhook_deliveries).any? { |column| column.name.match?(/private_key|secret|token/) }

    indexes = connection.indexes(:github_webhook_deliveries)
    assert indexes.any? { |index| index.unique && index.columns == [ "delivery_id" ] }
    assert indexes.any? { |index| index.columns == %w[processing_state received_at] }
    assert indexes.any? { |index| index.columns == %w[repository_id head_sha] }

    checks = connection.check_constraints(:github_webhook_deliveries).map(&:name)
    assert_includes checks, "github_webhook_deliveries_processing_state_valid"
    assert_includes checks, "github_webhook_deliveries_attempts_nonnegative"

    assert_equal before, Cohort.pluck(:id, :settings)
    assert_equal 0, GithubWebhookDelivery.count
  ensure
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:github_webhook_deliveries)
    ensure
      ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
      GithubWebhookDelivery.reset_column_information
    end
  end
end
