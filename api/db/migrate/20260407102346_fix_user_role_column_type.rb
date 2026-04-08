class FixUserRoleColumnType < ActiveRecord::Migration[8.1]
  def up
    col = ActiveRecord::Base.connection.columns(:users).find { |c| c.name == "role" }
    return unless col

    if col.type == :string
      remove_index :users, :role if index_exists?(:users, :role)
      remove_column :users, :role
      add_column :users, :role, :integer, default: 0, null: false
      add_index :users, :role
    end
  end

  def down
    col = ActiveRecord::Base.connection.columns(:users).find { |c| c.name == "role" }
    return unless col

    if col.type == :integer
      remove_index :users, :role if index_exists?(:users, :role)
      remove_column :users, :role
      add_column :users, :role, :string
      add_index :users, :role
    end
  end
end
