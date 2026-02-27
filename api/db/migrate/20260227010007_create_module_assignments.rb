class CreateModuleAssignments < ActiveRecord::Migration[8.1]
  def change
    create_table :module_assignments do |t|
      t.references :enrollment, null: false, foreign_key: true
      t.references :module, null: false, foreign_key: { to_table: :modules }
      t.boolean :unlocked, default: true, null: false
      t.date :unlock_date_override

      t.timestamps
    end

    add_index :module_assignments, [:enrollment_id, :module_id], unique: true
  end
end
