# Template files on a curriculum, and where each cohort item came from, in
# one migration so a rollback is all or nothing.
#
# curriculum_files holds the same three kinds as cohort_files (uploads, links
# and Learn Docs). A new cohort starts with a class copy of every ready
# template; "Import from curriculum" brings in any added since. A cohort item
# names the template (source_curriculum_file_id) or the other cohort's class
# item (source_cohort_file_id) it was copied from, and the partial unique
# indexes keep each import to one class copy per cohort.
#
# auto_copy_to_students marks a class item every active learner gets a copy
# of in their own folder, now and whenever they enroll later. Those copies
# use source_file_id like "Copy to all students", so the existing
# one-copy-per-student index keeps the two paths from duplicating each other.
class CreateCurriculumFilesAndAutoCopy < ActiveRecord::Migration[8.1]
  def up
    create_table :curriculum_files do |t|
      t.references :curriculum, null: false, index: true, foreign_key: { to_table: :curricula }
      t.string :kind, null: false, default: "file", limit: 20
      t.string :title, null: false, limit: 160
      t.string :folder, null: false, default: "General", limit: 80
      t.text :description
      t.string :visibility, null: false, default: "students", limit: 20
      t.boolean :auto_copy_to_students, null: false, default: false
      t.string :filename, limit: 180
      t.string :content_type, limit: 160
      t.bigint :file_size
      t.string :s3_key
      t.string :upload_key
      t.datetime :upload_expires_at
      t.text :external_url
      t.string :link_provider, limit: 40
      t.text :doc_content
      t.integer :doc_version, null: false, default: 1
      t.datetime :doc_updated_at
      t.references :doc_updated_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
      t.boolean :ready, null: false, default: false
      t.datetime :ready_at
      t.references :uploaded_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
      t.timestamps
      t.check_constraint "kind IN ('file', 'link', 'doc')", name: "curriculum_files_kind_valid"
      t.check_constraint "visibility IN ('students', 'staff_only')", name: "curriculum_files_visibility_valid"
      t.check_constraint "NOT (visibility = 'staff_only' AND auto_copy_to_students = true)", name: "curriculum_files_auto_copy_shared"
    end
    # A curriculum copy names the same stored object (see CurriculumCopyForCohort),
    # so s3_key is not unique; staging keys always are.
    add_index :curriculum_files, :s3_key
    add_index :curriculum_files, :upload_key, unique: true
    add_index :curriculum_files, [ :curriculum_id, :folder ]
    add_index :curriculum_files, [ :ready, :upload_expires_at ]

    add_column :cohort_files, :auto_copy_to_students, :boolean, null: false, default: false
    add_reference :cohort_files, :source_curriculum_file, null: true, index: false, foreign_key: { to_table: :curriculum_files, on_delete: :nullify }
    add_reference :cohort_files, :source_cohort_file, null: true, index: false, foreign_key: { to_table: :cohort_files, on_delete: :nullify }
    add_check_constraint :cohort_files, "NOT (visibility = 'staff_only' AND auto_copy_to_students = true)", name: "cohort_files_auto_copy_shared"
    add_check_constraint :cohort_files, "NOT (student_id IS NOT NULL AND auto_copy_to_students = true)", name: "cohort_files_auto_copy_class_only"
    add_index :cohort_files, [ :cohort_id, :source_curriculum_file_id ], unique: true,
      where: "student_id IS NULL AND source_curriculum_file_id IS NOT NULL", name: "index_cohort_files_one_import_per_template"
    add_index :cohort_files, [ :cohort_id, :source_cohort_file_id ], unique: true,
      where: "student_id IS NULL AND source_cohort_file_id IS NOT NULL", name: "index_cohort_files_one_copy_per_cohort_item"
    add_index :cohort_files, :source_curriculum_file_id
    add_index :cohort_files, :source_cohort_file_id
    add_index :cohort_files, :cohort_id, where: "auto_copy_to_students = true AND student_id IS NULL", name: "index_cohort_files_auto_copy"
  end

  # Template rows name stored objects, so a rollback refuses while any exist
  # (delete them in the app, which cleans storage). The tables are locked
  # until the migration's transaction ends, so nothing is added after the check.
  def down
    execute "LOCK TABLE curriculum_files, cohort_files IN ACCESS EXCLUSIVE MODE"
    if select_value("SELECT 1 FROM curriculum_files LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Delete curriculum template files (and their stored objects) before rolling back"
    end

    remove_index :cohort_files, name: "index_cohort_files_auto_copy"
    remove_index :cohort_files, :source_cohort_file_id
    remove_index :cohort_files, :source_curriculum_file_id
    remove_index :cohort_files, name: "index_cohort_files_one_copy_per_cohort_item"
    remove_index :cohort_files, name: "index_cohort_files_one_import_per_template"
    remove_check_constraint :cohort_files, name: "cohort_files_auto_copy_class_only"
    remove_check_constraint :cohort_files, name: "cohort_files_auto_copy_shared"
    remove_reference :cohort_files, :source_cohort_file, index: false, foreign_key: { to_table: :cohort_files }
    remove_reference :cohort_files, :source_curriculum_file, index: false, foreign_key: { to_table: :curriculum_files }
    remove_column :cohort_files, :auto_copy_to_students
    drop_table :curriculum_files
  end
end
