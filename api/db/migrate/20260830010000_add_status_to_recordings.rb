class AddStatusToRecordings < ActiveRecord::Migration[8.1]
  def up
    # Keep every existing recording available, then make draft the default for
    # recordings created after this migration.
    add_column :recordings, :status, :integer, default: 1, null: false
    add_index :recordings, [ :cohort_id, :status, :position ]
    change_column_default :recordings, :status, from: 1, to: 0
  end

  def down
    remove_index :recordings, column: [ :cohort_id, :status, :position ]
    remove_column :recordings, :status
  end
end
