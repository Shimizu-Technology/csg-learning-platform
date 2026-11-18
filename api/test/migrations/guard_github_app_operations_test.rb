require "test_helper"
require Rails.root.join("db/migrate/20261119050000_guard_github_app_operations").to_s

class GuardGithubAppOperationsTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  test "generation migration is additive nullable reversible and idempotent" do
    migration = GuardGithubAppOperations.new
    users = User.pluck(:id, :github_username, :github_user_id)
    installations = GithubAppInstallation.pluck(:id, :connection_state)
    migration.migrate(:down)
    clear_caches
    refute ActiveRecord::Base.connection.column_exists?(:users, :github_authorization_generation)
    migration.migrate(:up)
    migration.migrate(:up)
    clear_caches
    assert ActiveRecord::Base.connection.column_exists?(:github_app_installations, :connection_generation)
    assert_equal users, User.pluck(:id, :github_username, :github_user_id)
    assert_equal installations, GithubAppInstallation.pluck(:id, :connection_state)
  ensure
    migration&.migrate(:up)
    clear_caches
  end
  def clear_caches
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ User, GithubAppInstallation ].each(&:reset_column_information)
  end
end
