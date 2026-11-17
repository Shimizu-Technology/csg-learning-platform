class RefineAuthoringCloneReceipts < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    add_column :authoring_clones, :definition_map, :jsonb, default: {}, null: false
    remove_index :authoring_clones, name: "index_authoring_clones_on_user_id"
  end

  def down
    execute "SET LOCAL lock_timeout = '5s'"
    add_index :authoring_clones, :user_id
    remove_column :authoring_clones, :definition_map
  end
end
