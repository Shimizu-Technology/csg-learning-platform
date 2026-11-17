class CreateSubmissionAuditReviews < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      create_table :submission_audit_reviews do |t|
        t.references :content_block, null: false, foreign_key: true, index: { unique: true }
        t.references :reviewed_by, null: false, foreign_key: { to_table: :users }
        t.string :content_digest, null: false
        t.timestamps
      end
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :submission_audit_reviews
    end
  end
end
