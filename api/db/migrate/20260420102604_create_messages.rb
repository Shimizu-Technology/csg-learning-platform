class CreateMessages < ActiveRecord::Migration[8.1]
  def change
    create_table :messages do |t|
      t.references :channel, null: false, foreign_key: true
      t.references :author, null: false, foreign_key: { to_table: :users }
      t.references :parent_message, null: true, foreign_key: { to_table: :messages }
      t.text :body, null: false
      t.datetime :edited_at
      t.datetime :deleted_at

      t.timestamps
    end

    add_index :messages, [ :channel_id, :created_at ]
    add_index :messages, [ :channel_id, :deleted_at ]
  end
end
