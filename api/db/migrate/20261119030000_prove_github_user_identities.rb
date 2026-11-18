class ProveGithubUserIdentities < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  USER_COLUMNS = %i[github_user_id github_verified_login github_verified_at github_authorization_nonce_digest].freeze
  INDEX = "index_users_on_verified_github_user_id".freeze

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      add_column :users, :github_user_id, :string unless column_exists?(:users, :github_user_id)
      add_column :users, :github_verified_login, :string unless column_exists?(:users, :github_verified_login)
      add_column :users, :github_verified_at, :datetime unless column_exists?(:users, :github_verified_at)
      add_column :users, :github_authorization_nonce_digest, :string unless column_exists?(:users, :github_authorization_nonce_digest)
      add_column :github_repository_bindings, :github_user_id, :string unless column_exists?(:github_repository_bindings, :github_user_id)
      # Only new proven IDs participate. Legacy duplicate usernames stay intact.
      add_index :users, "LOWER(github_user_id)", unique: true, where: "github_user_id IS NOT NULL", name: INDEX unless connection.indexes(:users).any? { |index| index.name == INDEX }
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_index :users, name: INDEX if connection.indexes(:users).any? { |index| index.name == INDEX }
      remove_column :github_repository_bindings, :github_user_id if column_exists?(:github_repository_bindings, :github_user_id)
      USER_COLUMNS.reverse_each { |column| remove_column :users, column if column_exists?(:users, column) }
    end
  end
end
