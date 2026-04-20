class CreateNotifications < ActiveRecord::Migration[8.1]
  def change
    create_table :notifications do |t|
      t.references :user, null: false, foreign_key: true
      t.references :actor, null: true, foreign_key: { to_table: :users }
      t.integer :notification_type, null: false, default: 0
      t.string :title, null: false
      t.text :body
      t.string :path, null: false
      t.references :notifiable, polymorphic: true, null: false
      t.datetime :read_at

      t.timestamps
    end

    add_index :notifications, [ :user_id, :read_at, :created_at ]
    add_index :notifications, [ :notifiable_type, :notifiable_id, :user_id ], unique: true, name: "index_notifications_unique_source_per_user"
  end
end
