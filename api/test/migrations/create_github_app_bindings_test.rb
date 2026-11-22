require "test_helper"
require Rails.root.join("db/migrate/20261118170000_create_github_app_bindings").to_s

require Rails.root.join("db/migrate/20261119030000_prove_github_user_identities").to_s

require Rails.root.join("db/migrate/20261119050000_guard_github_app_operations").to_s
require Rails.root.join("db/migrate/20261122060000_create_github_issue_deliveries").to_s

class CreateGithubAppBindingsTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "additive migration rolls back and reapplies with unique binding scopes and no secrets" do
    deliveries_migration = CreateGithubIssueDeliveries.new
    had_deliveries_table = ActiveRecord::Base.connection.table_exists?(:github_issue_deliveries)
    deliveries_migration.migrate(:down) if had_deliveries_table

    migration = CreateGithubAppBindings.new
    before = Cohort.pluck(:id, :settings)
    migration.migrate(:down)
    refute ActiveRecord::Base.connection.table_exists?(:github_repository_bindings)
    migration.migrate(:up)
    connection = ActiveRecord::Base.connection
    %w[github_app_installations github_repository_bindings].each do |table|
      refute connection.columns(table).any? { |column| column.name.match?(/private_key|secret|token/) }
    end
    indexes = connection.indexes(:github_repository_bindings).select(&:unique)
    assert_equal 2, indexes.size
    assert indexes.any? { |index| index.columns == [ "enrollment_id" ] && index.where.include?("IS NULL") }
    assert indexes.any? { |index| index.columns == %w[enrollment_id curriculum_module_id] && index.where.include?("IS NOT NULL") }
    assert_equal before, Cohort.pluck(:id, :settings)
    assert_equal 0, GithubRepositoryBinding.count
    assert_equal 0, GithubAppInstallation.count
  ensure
    begin
      migration&.migrate(:up) unless ActiveRecord::Base.connection.table_exists?(:github_repository_bindings)
    ensure
      ProveGithubUserIdentities.new.migrate(:up)
      GuardGithubAppOperations.new.migrate(:up)
      deliveries_migration&.migrate(:up) if had_deliveries_table && !ActiveRecord::Base.connection.table_exists?(:github_issue_deliveries)
      ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
      [ GithubAppInstallation, GithubRepositoryBinding, GithubIssueDelivery ].each(&:reset_column_information)
    end
  end
end
