# Every published (or pending) version of an uploaded cohort file. The
# cohort_files row mirrors the current version; older rows keep their own
# stored objects. A row starts pending (ready: false) like a new upload and is
# published by the version `complete` call.
class CreateCohortFileVersions < ActiveRecord::Migration[8.1]
  def up
    create_table :cohort_file_versions do |t|
      t.references :cohort_file, null: false, index: true, foreign_key: { on_delete: :cascade }
      t.integer :version_number, null: false
      t.string :s3_key, null: false
      t.string :upload_key, null: false
      t.datetime :upload_expires_at, null: false
      t.string :filename, null: false, limit: 180
      t.string :content_type, null: false, limit: 160
      t.bigint :file_size, null: false
      t.references :uploaded_by, null: true, foreign_key: { to_table: :users, on_delete: :nullify }
      t.string :note, limit: 300
      t.boolean :ready, null: false, default: false
      t.datetime :ready_at
      t.timestamps
    end
    add_index :cohort_file_versions, [ :cohort_file_id, :version_number ], unique: true, name: "index_cohort_file_versions_one_number_per_file"
    add_index :cohort_file_versions, [ :ready, :upload_expires_at ]
  end

  # Dropping version rows would orphan their stored objects, so a rollback
  # refuses while any exist. The table lock (held until the migration's
  # transaction ends) stops a version being inserted after the check.
  def down
    execute "LOCK TABLE cohort_file_versions IN ACCESS EXCLUSIVE MODE"
    if select_value("SELECT 1 FROM cohort_file_versions LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Delete cohort file versions (and their stored objects) before rolling back"
    end

    drop_table :cohort_file_versions
  end
end
