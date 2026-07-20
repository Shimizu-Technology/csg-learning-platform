class CreateMobilePushTokens < ActiveRecord::Migration[8.1]
  def change
    create_table :mobile_push_tokens do |t|
      t.references :user, null: false, foreign_key: true
      t.string :token, null: false
      t.string :platform, null: false
      t.string :device_id
      t.string :app_version
      t.datetime :last_seen_at, null: false
      t.datetime :failed_at
      t.timestamps
    end

    add_index :mobile_push_tokens, :token, unique: true
    add_index :mobile_push_tokens, [ :user_id, :failed_at ]
  end
end
