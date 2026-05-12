class AddArchivedAtToUsers < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :archived_at, :datetime
    add_index :users, :archived_at
  end
end
