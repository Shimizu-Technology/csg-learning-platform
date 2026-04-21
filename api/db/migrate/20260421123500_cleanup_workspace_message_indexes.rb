class CleanupWorkspaceMessageIndexes < ActiveRecord::Migration[8.1]
  def up
    remove_index :channels, name: "index_channels_on_cohort_id_and_name", if_exists: true
    remove_index :channels, name: "index_channels_on_cohort_id_and_status_and_position", if_exists: true
    remove_index :direct_conversations, name: "idx_direct_conversations_member_key", if_exists: true

    add_index :workspaces, :cohort_id,
      unique: true,
      where: "cohort_id IS NOT NULL",
      name: "index_workspaces_on_cohort_id_unique",
      if_not_exists: true
  end

  def down
    remove_index :workspaces, name: "index_workspaces_on_cohort_id_unique", if_exists: true

    add_index :channels, [ :cohort_id, :name ], unique: true, if_not_exists: true
    add_index :channels, [ :cohort_id, :status, :position ], if_not_exists: true
    add_index :direct_conversations, [ :cohort_id, :member_key ],
      unique: true,
      name: "idx_direct_conversations_member_key",
      if_not_exists: true
  end
end
