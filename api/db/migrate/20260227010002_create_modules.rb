class CreateModules < ActiveRecord::Migration[8.1]
  def change
    create_table :modules do |t|
      t.references :curriculum, null: false, foreign_key: { to_table: :curricula }
      t.string :name, null: false
      t.integer :module_type, default: 0, null: false
      t.text :description
      t.integer :position, default: 0, null: false
      t.integer :total_days
      t.integer :day_offset, default: 0, null: false

      t.timestamps
    end

    add_index :modules, [:curriculum_id, :position]
  end
end
