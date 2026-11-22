class CreateGithubIssueDeliveries < ActiveRecord::Migration[8.1]
  # Additive outbox table only; SET LOCAL and all DDL share a transaction on PgBouncer.
  disable_ddl_transaction!

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"

      unless table_exists?(:github_issue_deliveries)
        create_table :github_issue_deliveries do |t|
          t.references :submission, null: false, foreign_key: { on_delete: :cascade }
          t.references :enrollment, null: false, foreign_key: { on_delete: :cascade }, index: false
          t.references :content_block, null: false, foreign_key: { on_delete: :cascade }
          t.references :github_repository_binding, null: true, foreign_key: { on_delete: :nullify }
          t.bigint :repository_id
          t.string :repository_full_name
          t.string :action, null: false
          t.string :grade, null: false
          t.text :feedback_body
          t.string :dedupe_token, null: false
          t.string :status, null: false, default: "pending"
          t.integer :issue_number
          t.string :issue_url
          t.integer :attempts, null: false, default: 0
          t.text :last_error
          t.datetime :next_retry_at
          t.string :claim_token
          t.datetime :claimed_until
          t.datetime :delivered_at
          t.timestamps
        end
      end

      unless column_exists?(:github_issue_deliveries, :claim_token)
        add_column :github_issue_deliveries, :claim_token, :string
      end
      unless column_exists?(:github_issue_deliveries, :claimed_until)
        add_column :github_issue_deliveries, :claimed_until, :datetime
      end

      unless index_exists?(:github_issue_deliveries, :dedupe_token, unique: true)
        add_index :github_issue_deliveries, :dedupe_token, unique: true
      end
      unless index_exists?(:github_issue_deliveries, [ :status, :next_retry_at ], name: "index_github_issue_deliveries_on_status_and_retry")
        add_index :github_issue_deliveries, [ :status, :next_retry_at ], name: "index_github_issue_deliveries_on_status_and_retry"
      end
      unless index_exists?(:github_issue_deliveries, [ :enrollment_id, :content_block_id, :repository_id ], name: "index_github_issue_deliveries_on_scope")
        add_index :github_issue_deliveries, [ :enrollment_id, :content_block_id, :repository_id ], name: "index_github_issue_deliveries_on_scope"
      end
      unless index_exists?(:github_issue_deliveries, [ :enrollment_id, :content_block_id, :claimed_until ], name: "index_github_issue_deliveries_on_scope_and_claim")
        add_index :github_issue_deliveries, [ :enrollment_id, :content_block_id, :claimed_until ], name: "index_github_issue_deliveries_on_scope_and_claim"
      end

      unless check_constraint_exists?(:github_issue_deliveries, name: "github_issue_deliveries_action_valid")
        add_check_constraint :github_issue_deliveries, "action IN ('open_or_comment', 'close')", name: "github_issue_deliveries_action_valid"
      end
      unless check_constraint_exists?(:github_issue_deliveries, name: "github_issue_deliveries_grade_valid")
        add_check_constraint :github_issue_deliveries, "grade IN ('A', 'B', 'C', 'R')", name: "github_issue_deliveries_grade_valid"
      end
      unless check_constraint_exists?(:github_issue_deliveries, name: "github_issue_deliveries_status_valid")
        add_check_constraint :github_issue_deliveries, "status IN ('pending', 'delivered', 'failed', 'obsolete')", name: "github_issue_deliveries_status_valid"
      end
      unless check_constraint_exists?(:github_issue_deliveries, name: "github_issue_deliveries_attempts_nonnegative")
        add_check_constraint :github_issue_deliveries, "attempts >= 0", name: "github_issue_deliveries_attempts_nonnegative"
      end
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :github_issue_deliveries if table_exists?(:github_issue_deliveries)
    end
  end
end
