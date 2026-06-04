class CreateCohortModuleSubmissionWindows < ActiveRecord::Migration[8.1]
  def change
    create_table :cohort_module_submission_windows do |t|
      t.references :cohort, null: false, foreign_key: true
      t.bigint :module_id, null: false
      t.integer :week_number, null: false
      t.datetime :submissions_close_at
      t.references :created_by, foreign_key: { to_table: :users }
      t.references :updated_by, foreign_key: { to_table: :users }
      t.timestamps
    end

    add_foreign_key :cohort_module_submission_windows, :modules, column: :module_id
    add_index :cohort_module_submission_windows,
      [ :cohort_id, :module_id, :week_number ],
      unique: true,
      name: "idx_submission_windows_on_cohort_module_week"
    add_index :cohort_module_submission_windows,
      [ :cohort_id, :module_id, :submissions_close_at ],
      name: "idx_submission_windows_on_cohort_module_close"
  end
end
