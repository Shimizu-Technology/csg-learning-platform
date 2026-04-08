class AddNameFieldsToUsers < ActiveRecord::Migration[8.1]
  def change
    change_table :users, bulk: true do |t|
      t.string :first_name  unless column_exists?(:users, :first_name)
      t.string :last_name   unless column_exists?(:users, :last_name)
      t.string :github_username  unless column_exists?(:users, :github_username)
      t.string :avatar_url       unless column_exists?(:users, :avatar_url)
      t.datetime :last_sign_in_at unless column_exists?(:users, :last_sign_in_at)
    end

    # The shared schema may define role as string; the app needs integer for enum
    if column_exists?(:users, :role) && columns(:users).find { |c| c.name == "role" }.type == :string
      remove_column :users, :role
      add_column :users, :role, :integer, default: 0, null: false
      add_index :users, :role unless index_exists?(:users, :role)
    end
  end
end
