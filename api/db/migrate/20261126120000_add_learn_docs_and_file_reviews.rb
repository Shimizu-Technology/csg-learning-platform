# Learn Docs and the file review loop, in one migration so a rollback is all
# or nothing. Docs keep their Markdown on the cohort_files row (kind "doc"),
# with a version number every save advances, who saved it last and when.
# Saved states live in cohort_doc_revisions. Every item in a student's
# folder can be sent for review, and has a comment thread in
# cohort_file_comments.
class AddLearnDocsAndFileReviews < ActiveRecord::Migration[8.1]
  def up
    add_column :cohort_files, :doc_content, :text
    add_column :cohort_files, :doc_version, :integer, null: false, default: 1
    add_column :cohort_files, :doc_updated_at, :datetime
    add_reference :cohort_files, :doc_updated_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
    add_column :cohort_files, :review_status, :string, null: false, default: "none", limit: 20
    add_reference :cohort_files, :reviewed_by, null: true, index: true, foreign_key: { to_table: :users, on_delete: :nullify }
    add_column :cohort_files, :reviewed_at, :datetime
    add_index :cohort_files, [ :cohort_id, :review_status ]

    # Saved states of a doc, numbered 1..n per doc and stamped with when the
    # doc had them, so a paused learner can be shown the newest one from
    # before their pause.
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

    create_table :cohort_file_comments do |t|
      t.references :cohort_file, null: false, index: true, foreign_key: { on_delete: :cascade }
      t.references :user, null: false, index: true, foreign_key: { on_delete: :cascade }
      t.text :body, null: false
      t.timestamps
    end
    add_index :cohort_file_comments, [ :cohort_file_id, :created_at ]
  end

  # Rolling back would lose docs, their history, reviews and comments, so it
  # refuses while any exist. All three tables are locked (until the
  # migration's transaction ends) and every check runs before anything is
  # dropped, so nothing can be written in between and nothing is half undone.
  def down
    execute "LOCK TABLE cohort_files, cohort_doc_revisions, cohort_file_comments IN ACCESS EXCLUSIVE MODE"
    remaining = {
      "Learn Docs" => "SELECT 1 FROM cohort_files WHERE kind = 'doc' LIMIT 1",
      "review statuses" => "SELECT 1 FROM cohort_files WHERE review_status <> 'none' LIMIT 1",
      "doc revisions" => "SELECT 1 FROM cohort_doc_revisions LIMIT 1",
      "file comments" => "SELECT 1 FROM cohort_file_comments LIMIT 1"
    }.select { |_, sql| select_value(sql) }.keys
    raise ActiveRecord::IrreversibleMigration, "Remove #{remaining.to_sentence} before rolling back" if remaining.any?

    drop_table :cohort_file_comments
    drop_table :cohort_doc_revisions
    remove_index :cohort_files, [ :cohort_id, :review_status ]
    remove_column :cohort_files, :reviewed_at
    remove_reference :cohort_files, :reviewed_by, foreign_key: { to_table: :users }
    remove_column :cohort_files, :review_status
    remove_reference :cohort_files, :doc_updated_by, foreign_key: { to_table: :users }
    remove_column :cohort_files, :doc_updated_at
    remove_column :cohort_files, :doc_version
    remove_column :cohort_files, :doc_content
  end
end
