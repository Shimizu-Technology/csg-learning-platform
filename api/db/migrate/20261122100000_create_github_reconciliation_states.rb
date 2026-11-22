class CreateGithubReconciliationStates < ActiveRecord::Migration[8.1]
  # Additive table only; SET LOCAL and all DDL share a transaction on PgBouncer.
  disable_ddl_transaction!

  STATUSES = %w[idle ok backoff failed].freeze

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"

      create_table :github_reconciliation_states, if_not_exists: true do |t|
        t.references :github_repository_binding, null: false, index: { unique: true }, foreign_key: { on_delete: :cascade }
        t.datetime :activated_at, null: false
        t.string :last_head_sha
        t.datetime :last_reconciled_at
        t.datetime :next_reconcile_at
        t.integer :consecutive_failures, null: false, default: 0
        t.text :last_error
        t.string :claim_token
        t.datetime :claimed_until
        t.string :last_status, null: false, default: "idle"
        t.timestamps
      end

      add_index :github_reconciliation_states, :next_reconcile_at,
        name: "index_github_reconciliation_states_on_next_reconcile_at", if_not_exists: true

      existing_checks = check_constraints(:github_reconciliation_states).map(&:name)
      unless existing_checks.include?("github_reconciliation_states_consecutive_failures_nonnegative")
        add_check_constraint :github_reconciliation_states,
          "consecutive_failures >= 0",
          name: "github_reconciliation_states_consecutive_failures_nonnegative"
      end
      unless existing_checks.include?("github_reconciliation_states_last_status_valid")
        add_check_constraint :github_reconciliation_states,
          "last_status IN (#{STATUSES.map { |status| "'#{status}'" }.join(', ')})",
          name: "github_reconciliation_states_last_status_valid"
      end
      unless existing_checks.include?("github_reconciliation_states_claim_lease_consistent")
        add_check_constraint :github_reconciliation_states,
          "(claim_token IS NULL) = (claimed_until IS NULL)",
          name: "github_reconciliation_states_claim_lease_consistent"
      end
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      drop_table :github_reconciliation_states, if_exists: true
    end
  end
end
