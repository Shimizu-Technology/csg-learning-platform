# Review comments on a file in a student's folder, between that student and
# cohort staff.
class CreateCohortFileComments < ActiveRecord::Migration[8.1]
  def up
    create_table :cohort_file_comments do |t|
      t.references :cohort_file, null: false, index: true, foreign_key: { on_delete: :cascade }
      t.references :user, null: false, index: true, foreign_key: { on_delete: :cascade }
      t.text :body, null: false
      t.timestamps
    end
    add_index :cohort_file_comments, [ :cohort_file_id, :created_at ]
  end

  # Refuses while comments exist; the table lock stops one being added after the check.
  def down
    execute "LOCK TABLE cohort_file_comments IN ACCESS EXCLUSIVE MODE"
    if select_value("SELECT 1 FROM cohort_file_comments LIMIT 1")
      raise ActiveRecord::IrreversibleMigration, "Delete file comments before rolling back"
    end

    drop_table :cohort_file_comments
  end
end
