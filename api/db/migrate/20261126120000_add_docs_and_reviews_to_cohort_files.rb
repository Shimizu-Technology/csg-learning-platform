# Learn Docs keep their Markdown on the cohort_files row (kind "doc"), with
# who last saved it. Every file in a student's folder can also be marked
# ready for review and reviewed by staff.
class AddDocsAndReviewsToCohortFiles < ActiveRecord::Migration[8.1]
  def up
    add_column :cohort_files, :doc_content, :text
    add_column :cohort_files, :doc_updated_at, :datetime
    add_reference :cohort_files, :doc_updated_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
    add_column :cohort_files, :review_status, :string, null: false, default: "none", limit: 20
    add_reference :cohort_files, :reviewed_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
    add_column :cohort_files, :reviewed_at, :datetime
    add_index :cohort_files, [ :cohort_id, :review_status ]
  end

  # A doc row without its content would be empty, so a rollback refuses while
  # any exist. The table lock (held until the migration's transaction ends)
  # stops a doc being created after the check.
  def down
    execute "LOCK TABLE cohort_files IN ACCESS EXCLUSIVE MODE"
    if select_value("SELECT 1 FROM cohort_files WHERE kind = 'doc' LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Delete Learn Docs before rolling back"
    end

    remove_index :cohort_files, [ :cohort_id, :review_status ]
    remove_column :cohort_files, :reviewed_at
    remove_reference :cohort_files, :reviewed_by, foreign_key: { to_table: :users }
    remove_column :cohort_files, :review_status
    remove_reference :cohort_files, :doc_updated_by, foreign_key: { to_table: :users }
    remove_column :cohort_files, :doc_updated_at
    remove_column :cohort_files, :doc_content
  end
end
