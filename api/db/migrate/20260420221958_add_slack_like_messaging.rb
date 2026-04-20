class AddSlackLikeMessaging < ActiveRecord::Migration[8.1]
  def change
    create_table :direct_conversations do |t|
      t.references :cohort, null: false, foreign_key: true
      t.integer :status, null: false, default: 0

      t.timestamps
    end

    create_table :direct_conversation_members do |t|
      t.references :direct_conversation, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.datetime :last_read_at

      t.timestamps
    end
    add_index :direct_conversation_members, [ :direct_conversation_id, :user_id ], unique: true, name: "idx_direct_members_unique"
    add_index :direct_conversation_members, [ :user_id, :direct_conversation_id ], name: "idx_direct_members_user_conversation"

    change_column_null :messages, :channel_id, true
    change_column_null :messages, :body, true
    add_reference :messages, :direct_conversation, null: true, foreign_key: true
    add_reference :messages, :pinned_by, null: true, foreign_key: { to_table: :users }
    add_column :messages, :pinned_at, :datetime
    add_index :messages, [ :direct_conversation_id, :created_at ], name: "idx_messages_on_direct_conversation_created"
    add_index :messages, :pinned_at

    create_table :message_attachments do |t|
      t.references :message, null: false, foreign_key: true
      t.references :uploaded_by, null: false, foreign_key: { to_table: :users }
      t.string :s3_key, null: false
      t.string :filename, null: false
      t.string :content_type, null: false
      t.bigint :byte_size, null: false

      t.timestamps
    end
    add_index :message_attachments, :s3_key, unique: true

    create_table :message_reactions do |t|
      t.references :message, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.string :emoji, null: false

      t.timestamps
    end
    add_index :message_reactions, [ :message_id, :user_id, :emoji ], unique: true, name: "idx_message_reactions_unique"

    create_table :message_preferences do |t|
      t.references :user, null: false, foreign_key: true
      t.references :target, polymorphic: true, null: false
      t.boolean :muted, null: false, default: false

      t.timestamps
    end
    add_index :message_preferences, [ :user_id, :target_type, :target_id ], unique: true, name: "idx_message_preferences_unique"
  end
end
