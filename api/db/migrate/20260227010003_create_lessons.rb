class CreateLessons < ActiveRecord::Migration[8.1]
  def change
    create_table :lessons do |t|
      t.references :module, null: false, foreign_key: { to_table: :modules }
      t.string :title, null: false
      t.integer :lesson_type, default: 0, null: false
      t.integer :position, default: 0, null: false
      t.integer :release_day, default: 0, null: false
      t.boolean :required, default: true, null: false

      t.timestamps
    end

    add_index :lessons, [:module_id, :position]
    add_index :lessons, [:module_id, :release_day]
  end
end
