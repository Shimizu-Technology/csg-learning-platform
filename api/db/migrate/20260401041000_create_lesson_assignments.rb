class CreateLessonAssignments < ActiveRecord::Migration[8.1]
  def change
    create_table :lesson_assignments do |t|
      t.references :enrollment, null: false, foreign_key: true
      t.references :lesson, null: false, foreign_key: true
      t.boolean :unlocked, null: false, default: false
      t.date :unlock_date_override

      t.timestamps
    end

    add_index :lesson_assignments, [:enrollment_id, :lesson_id], unique: true
  end
end
