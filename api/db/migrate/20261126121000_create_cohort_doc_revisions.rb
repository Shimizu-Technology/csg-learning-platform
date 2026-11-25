# Saved states of a Learn Doc, numbered 1..n per doc. Each row is a state the
# doc actually had, stamped with when it was saved, so a paused learner can
# be shown the newest state from before their pause.
class CreateCohortDocRevisions < ActiveRecord::Migration[8.1]
  def up
    create_table :cohort_doc_revisions do |t|
      t.references :cohort_file, null: false, index: true, foreign_key: { on_delete: :cascade }
      t.integer :revision_number, null: false
      t.string :title, null: false, limit: 160
      t.text :content, null: false
      t.references :edited_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
      t.string :summary, limit: 200
      t.datetime :created_at, null: false
    end
    add_index :cohort_doc_revisions, [ :cohort_file_id, :revision_number ], unique: true, name: "index_cohort_doc_revisions_one_number_per_doc"
  end

  # Dropping revisions would lose doc history, so a rollback refuses while
  # any exist. The table lock stops a revision being saved after the check.
  def down
    execute "LOCK TABLE cohort_doc_revisions IN ACCESS EXCLUSIVE MODE"
    if select_value("SELECT 1 FROM cohort_doc_revisions LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Delete Learn Doc revisions before rolling back"
    end

    drop_table :cohort_doc_revisions
  end
end
