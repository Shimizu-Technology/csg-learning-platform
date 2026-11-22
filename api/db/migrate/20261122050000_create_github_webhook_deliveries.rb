class CreateGithubWebhookDeliveries < ActiveRecord::Migration[8.1]
  # Additive table only; SET LOCAL and all DDL share a transaction on PgBouncer.
  disable_ddl_transaction!

  PROCESSING_STATES = %w[pending processed staged ignored failed].freeze

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"

      create_table :github_webhook_deliveries, if_not_exists: true do |t|
        t.string :delivery_id, null: false
        t.string :event, null: false
        t.string :action
        t.bigint :installation_id
        t.bigint :repository_id
        t.string :head_sha
        t.jsonb :payload, null: false, default: {}
        t.string :processing_state, null: false, default: "pending"
        t.integer :attempts, null: false, default: 0
        t.text :last_error
        t.datetime :received_at, null: false
        t.datetime :processed_at
        t.timestamps
      end

      add_index :github_webhook_deliveries, :delivery_id, unique: true, if_not_exists: true
      add_index :github_webhook_deliveries, [ :processing_state, :received_at ],
        name: "index_github_webhook_deliveries_on_state_and_received_at", if_not_exists: true
      add_index :github_webhook_deliveries, [ :repository_id, :head_sha ],
        name: "index_github_webhook_deliveries_on_repo_and_head_sha", if_not_exists: true

      existing_checks = check_constraints(:github_webhook_deliveries).map(&:name)
      unless existing_checks.include?("github_webhook_deliveries_processing_state_valid")
        add_check_constraint :github_webhook_deliveries,
          "processing_state IN (#{PROCESSING_STATES.map { |state| "'#{state}'" }.join(', ')})",
          name: "github_webhook_deliveries_processing_state_valid"
      end
      unless existing_checks.include?("github_webhook_deliveries_attempts_nonnegative")
        add_check_constraint :github_webhook_deliveries,
          "attempts >= 0",
          name: "github_webhook_deliveries_attempts_nonnegative"
      end

      unless column_exists?(:submissions, :github_repository_id)
        add_column :submissions, :github_repository_id, :bigint
      end
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_column :submissions, :github_repository_id if column_exists?(:submissions, :github_repository_id)
      drop_table :github_webhook_deliveries, if_exists: true
    end
  end
end
