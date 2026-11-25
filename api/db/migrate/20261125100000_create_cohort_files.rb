class CreateCohortFiles < ActiveRecord::Migration[8.1]
  def change
    create_table :cohort_files do |t|
      t.references :cohort, null: false, index: false, foreign_key: { on_delete: :cascade }
      # NULL is a shared class file; a user id is that student's private folder.
      t.references :student, null: true, index: false, foreign_key: { to_table: :users, on_delete: :cascade }
      t.references :uploaded_by, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
      # The class file a "Copy to all students" row came from.
      t.references :source_file, null: true, foreign_key: { to_table: :cohort_files, on_delete: :nullify }
      t.string :folder, null: false, default: "General", limit: 80
      t.string :visibility, null: false, default: "students", limit: 20
      t.string :title, null: false, limit: 160
      t.text :description
      t.string :filename, null: false, limit: 180
      t.string :content_type, null: false, limit: 160
      t.bigint :file_size, null: false
      t.string :s3_key, null: false
      t.string :upload_key, null: false
      t.datetime :upload_expires_at, null: false
      t.boolean :ready, null: false, default: false
      t.datetime :ready_at
      t.timestamps
    end
    add_index :cohort_files, :s3_key, unique: true
    add_index :cohort_files, :upload_key, unique: true
    add_index :cohort_files, [ :cohort_id, :student_id, :ready ]
    add_index :cohort_files, [ :cohort_id, :folder ]
    add_index :cohort_files, :student_id
    # One copy of a class file per student folder, so "Copy to all students" is idempotent.
    add_index :cohort_files, [ :cohort_id, :student_id, :source_file_id ], unique: true,
      where: "source_file_id IS NOT NULL AND student_id IS NOT NULL", name: "index_cohort_files_one_copy_per_student"
  end
end
