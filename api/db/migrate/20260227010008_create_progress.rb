class CreateProgress < ActiveRecord::Migration[8.1]
  def change
    create_table :progresses do |t|
      t.references :user, null: false, foreign_key: true
      t.references :content_block, null: false, foreign_key: true
      t.integer :status, default: 0, null: false
      t.datetime :completed_at

      t.timestamps
    end

    add_index :progresses, [:user_id, :content_block_id], unique: true
  end
end
