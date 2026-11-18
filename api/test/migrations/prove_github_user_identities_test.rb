require "test_helper"
require Rails.root.join("db/migrate/20261119030000_prove_github_user_identities").to_s

class ProveGithubUserIdentitiesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  test "migration preserves legacy duplicates adds no proof and enforces unique new ids" do
    migration = ProveGithubUserIdentities.new
    ids = []
    migration.migrate(:down)
    clear_pools
    2.times do |n|
      ids << User.insert!({ clerk_id: "migration-proof-#{n}", email: "migration-proof-#{n}@example.invalid", github_username: "duplicate-legacy" }).rows.sole.sole
    end
    migration.migrate(:up)
    clear_pools
    users = User.where(id: ids).order(:id)
    assert_equal [ "duplicate-legacy", "duplicate-legacy" ], users.pluck(:github_username)
    assert_equal [ nil, nil ], users.pluck(:github_user_id)
    assert_nil users.first.github_verified_at
    index = ActiveRecord::Base.connection.indexes(:users).find { |row| row.name == ProveGithubUserIdentities::INDEX }
    assert index.unique
    assert_match(/lower.*github_user_id/i, index.columns)
    users.first.update_columns(github_user_id: "24680")
    assert_raises(ActiveRecord::RecordNotUnique) do
      User.transaction(requires_new: true) { users.last.update_columns(github_user_id: "24680") }
    end
    migration.migrate(:up)
  ensure
    migration&.migrate(:up)
    clear_pools
    User.where(id: ids).delete_all if ids
  end
  def clear_pools
    ActiveRecord::Base.connection_handler.connection_pool_list.each { |pool| pool.connections.each(&:clear_cache!) }
    [ User, GithubRepositoryBinding ].each(&:reset_column_information)
  end
end
