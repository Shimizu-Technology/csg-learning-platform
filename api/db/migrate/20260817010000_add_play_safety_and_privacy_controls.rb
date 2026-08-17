class AddPlaySafetyAndPrivacyControls < ActiveRecord::Migration[8.1]
  def change
    add_column :users, :community_terms_version, :string
    add_column :users, :community_terms_accepted_at, :datetime

    create_table :user_blocks do |t|
      t.references :blocker, null: false, foreign_key: { to_table: :users }
      t.references :blocked_user, null: false, foreign_key: { to_table: :users }
      t.timestamps
    end
    add_index :user_blocks, [ :blocker_id, :blocked_user_id ], unique: true
    add_check_constraint :user_blocks, "blocker_id <> blocked_user_id", name: "user_blocks_distinct_users"

    create_table :content_reports do |t|
      t.references :reporter, null: false, foreign_key: { to_table: :users }
      t.references :reported_user, null: false, foreign_key: { to_table: :users }
      t.references :message, foreign_key: true
      t.integer :reason, null: false, default: 0
      t.text :details
      t.integer :status, null: false, default: 0
      t.references :reviewed_by, foreign_key: { to_table: :users }
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :content_reports, [ :reporter_id, :message_id ], unique: true, where: "message_id IS NOT NULL", name: "index_unique_message_reports"
    add_index :content_reports, [ :reporter_id, :reported_user_id ], unique: true, where: "message_id IS NULL AND status IN (0, 1)", name: "index_one_open_user_report"
    add_index :content_reports, [ :status, :created_at ]

    create_table :data_deletion_requests do |t|
      t.references :user, null: false, foreign_key: true
      t.integer :status, null: false, default: 0
      t.text :retention_note
      t.references :resolved_by, foreign_key: { to_table: :users }
      t.datetime :resolved_at
      t.timestamps
    end
    add_index :data_deletion_requests, :user_id, unique: true, where: "status IN (0, 1)", name: "index_one_open_deletion_request_per_user"
  end
end
