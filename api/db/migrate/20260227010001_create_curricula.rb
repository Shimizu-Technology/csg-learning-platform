class CreateCurricula < ActiveRecord::Migration[8.1]
  def change
    create_table :curricula do |t|
      t.string :name, null: false
      t.text :description
      t.integer :total_weeks
      t.integer :status, default: 0, null: false

      t.timestamps
    end
  end
end
