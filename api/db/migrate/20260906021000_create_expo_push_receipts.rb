class CreateExpoPushReceipts < ActiveRecord::Migration[8.1]
  def change
    create_table :expo_push_receipts do |t|
      t.references :mobile_push_token, null: false, foreign_key: { on_delete: :cascade }
      t.string :receipt_id, null: false
      t.datetime :available_at, null: false
      t.integer :lookup_count, null: false, default: 0
      t.timestamps
    end

    add_index :expo_push_receipts, :receipt_id, unique: true
    add_index :expo_push_receipts, :available_at
  end
end
