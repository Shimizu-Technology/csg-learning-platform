class CreateEnrollmentRestarts < ActiveRecord::Migration[8.1]
  def change
    create_table :enrollment_restarts do |t|
      t.references :enrollment, null: true, foreign_key: { on_delete: :nullify }
      t.references :student, null: false, foreign_key: { to_table: :users }
      t.references :cohort, null: false, foreign_key: true
      t.references :performed_by, null: false, foreign_key: { to_table: :users }
      t.text :reason
      t.jsonb :snapshot, null: false, default: {}
      t.jsonb :records_removed, null: false, default: {}
      t.timestamps
    end

    add_index :enrollment_restarts, [ :student_id, :cohort_id, :created_at ],
      name: "index_enrollment_restarts_on_student_cohort_created"
  end
end
