class CreateAuthoringClones < ActiveRecord::Migration[8.1]
  def up
    execute "SET LOCAL lock_timeout = '5s'"
    create_table :authoring_clones do |t|
      t.references :user, null: false, foreign_key: true
      t.string :client_request_id, null: false
      t.string :fingerprint, null: false
      t.string :record_type, null: false
      t.bigint :record_id, null: false
      t.timestamps
    end
    add_index :authoring_clones, [ :user_id, :client_request_id ], unique: true
  end
  def down
    execute "SET LOCAL lock_timeout = '5s'"
    drop_table :authoring_clones
  end
end
