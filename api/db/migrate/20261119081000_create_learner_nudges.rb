# W9.3 learner nudges (AS-4). One row per nudge sent: its unique `key` is the
# exactly-once claim (learner, event, threshold), and the push columns are the
# same outbox announcements use. `users.learner_nudges_enabled` is the
# learner's opt-out of non-essential reminders. Additive only; nothing backfills.
class CreateLearnerNudges < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  KINDS = %w[due_soon inactive support_ending access_ending].freeze

  def up
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      create_table :learner_nudges do |t|
        t.references :enrollment, null: false, foreign_key: { on_delete: :cascade }, index: false
        t.string :kind, null: false
        t.string :threshold, null: false
        t.string :key, null: false
        t.boolean :essential, null: false, default: false
        t.datetime :event_at, null: false
        t.date :school_date, null: false
        t.string :title, null: false
        t.text :body
        t.string :path, null: false
        t.string :email_status, null: false, default: "not_requested"
        t.datetime :push_requested_at
        t.datetime :push_settled_at
        t.jsonb :web_push_attempted_notification_ids, null: false, default: []
        t.jsonb :expo_push_attempted_notification_ids, null: false, default: []
        t.timestamps
      end
      add_index :learner_nudges, :key, unique: true
      add_index :learner_nudges, [ :enrollment_id, :school_date ]
      add_index :learner_nudges, :push_requested_at, name: "index_learner_nudges_on_push_pending",
        where: "push_requested_at IS NOT NULL AND push_settled_at IS NULL"
      add_check_constraint :learner_nudges, "kind IN (#{KINDS.map { |kind| "'#{kind}'" }.join(', ')})", name: "learner_nudges_kind_valid"
      add_check_constraint :learner_nudges, "email_status IN ('not_requested', 'sent', 'failed', 'not_configured', 'no_address')", name: "learner_nudges_email_status_valid"
      # A constant default is a catalog-only change on PostgreSQL 11+.
      add_column :users, :learner_nudges_enabled, :boolean, null: false, default: true
    end
  end

  def down
    transaction do
      execute "SET LOCAL lock_timeout = '5s'"
      remove_column :users, :learner_nudges_enabled
      drop_table :learner_nudges
    end
  end
end
