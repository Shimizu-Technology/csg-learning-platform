class CreateContentBlocks < ActiveRecord::Migration[8.1]
  def change
    create_table :content_blocks do |t|
      t.references :lesson, null: false, foreign_key: true
      t.integer :block_type, default: 0, null: false
      t.integer :position, default: 0, null: false
      t.string :title
      t.text :body
      t.string :video_url
      t.text :solution
      t.string :filename
      t.jsonb :metadata, default: {}, null: false

      t.timestamps
    end

    add_index :content_blocks, [:lesson_id, :position]
    add_index :content_blocks, :block_type
  end
end
