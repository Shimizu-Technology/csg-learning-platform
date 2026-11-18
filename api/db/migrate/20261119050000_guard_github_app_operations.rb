class GuardGithubAppOperations < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      add_column :users, :github_authorization_generation, :string unless column_exists?(:users, :github_authorization_generation)
      add_column :github_app_installations, :connection_generation, :string unless column_exists?(:github_app_installations, :connection_generation)
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_column :github_app_installations, :connection_generation if column_exists?(:github_app_installations, :connection_generation)
      remove_column :users, :github_authorization_generation if column_exists?(:users, :github_authorization_generation)
    end
  end
end
