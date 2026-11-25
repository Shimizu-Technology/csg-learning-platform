# Links (and, later, in-app docs) live beside uploaded files, so the stored
# object columns become optional in the database; CohortFile still requires
# them for kind "file". version_number is the current version's number.
class AddKindAndVersionsToCohortFiles < ActiveRecord::Migration[8.1]
  OBJECT_COLUMNS = %i[filename content_type file_size s3_key upload_key upload_expires_at].freeze

  def up
    add_column :cohort_files, :kind, :string, null: false, default: "file", limit: 20
    add_column :cohort_files, :external_url, :text
    add_column :cohort_files, :link_provider, :string, limit: 40
    add_column :cohort_files, :version_number, :integer, null: false, default: 1
    OBJECT_COLUMNS.each { |column| change_column_null :cohort_files, column, true }
    add_index :cohort_files, [ :cohort_id, :kind ]
  end

  def down
    if select_value("SELECT 1 FROM cohort_files WHERE kind <> 'file' LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Remove link and doc cohort files before rolling back"
    end

    remove_index :cohort_files, [ :cohort_id, :kind ]
    OBJECT_COLUMNS.each { |column| change_column_null :cohort_files, column, false }
    remove_column :cohort_files, :version_number
    remove_column :cohort_files, :link_provider
    remove_column :cohort_files, :external_url
    remove_column :cohort_files, :kind
  end
end
