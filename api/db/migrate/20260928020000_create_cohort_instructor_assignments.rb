class CreateCohortInstructorAssignments < ActiveRecord::Migration[8.1]
  def up
    create_table :cohort_instructor_assignments do |t|
      t.references :cohort, null: false, foreign_key: true
      t.references :user, null: false, foreign_key: true
      t.timestamps
    end
    add_index :cohort_instructor_assignments, [ :cohort_id, :user_id ], unique: true, name: "idx_cohort_instructors_unique"

    # Existing instructors currently have access to every cohort. Preserve
    # that access on deploy; admins can then narrow assignments explicitly.
    execute <<~SQL
      INSERT INTO cohort_instructor_assignments (cohort_id, user_id, created_at, updated_at)
      SELECT cohorts.id, users.id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM cohorts CROSS JOIN users
      WHERE users.role = 1 AND users.archived_at IS NULL
    SQL
  end

  def down
    drop_table :cohort_instructor_assignments
  end
end
