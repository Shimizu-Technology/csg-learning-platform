class AddSchedulingToAnnouncements < ActiveRecord::Migration[8.1]
  # Scheduled updates (U-3.6): a draft with `scheduled_for` set is posted by
  # the hourly `scheduled:tick` once that time has passed. It stays a draft
  # until then, so every reader path that already hides drafts hides it too.
  # `scheduled_by_id` is who scheduled it: the tick checks, when it posts,
  # that they can still post to the update's audience. `scheduled_send_push`
  # is the "Send push when posted" choice made when scheduling.
  #
  # Additive only, so the previous release keeps working during rollout: the
  # new columns are nullable or have a default, and the foreign key is added
  # NOT VALID and validated in its own short transaction. Each step runs in an
  # explicit transaction with SET LOCAL lock_timeout, so the timeout and the
  # DDL share one session through Neon's transaction-mode pooler
  # (docs/DEPLOYMENT.md, migration rules). The partial index is what the tick
  # reads; the table holds a school's updates (hundreds of rows), so it is
  # built in the transaction rather than concurrently.
  disable_ddl_transaction!

  TABLE = :announcements
  FOREIGN_KEY = "fk_announcements_scheduled_by"
  INDEX = "index_announcements_on_scheduled_for_due"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :scheduled_for, :datetime unless column_exists?(TABLE, :scheduled_for)
      add_column TABLE, :scheduled_by_id, :bigint unless column_exists?(TABLE, :scheduled_by_id)
      add_column TABLE, :scheduled_send_push, :boolean, default: false, null: false unless column_exists?(TABLE, :scheduled_send_push)
    end
    unless foreign_key_exists?(TABLE, name: FOREIGN_KEY)
      with_lock_timeout do
        add_foreign_key TABLE, :users, column: :scheduled_by_id, name: FOREIGN_KEY, on_delete: :nullify, validate: false
      end
    end
    with_lock_timeout { validate_foreign_key TABLE, name: FOREIGN_KEY }
    unless index_exists?(TABLE, :scheduled_for, name: INDEX)
      with_lock_timeout { add_index TABLE, :scheduled_for, name: INDEX, where: "status = 0 AND scheduled_for IS NOT NULL" }
    end
  end

  def down
    with_lock_timeout do
      remove_index TABLE, name: INDEX if index_exists?(TABLE, :scheduled_for, name: INDEX)
      remove_foreign_key TABLE, name: FOREIGN_KEY if foreign_key_exists?(TABLE, name: FOREIGN_KEY)
      remove_column TABLE, :scheduled_send_push if column_exists?(TABLE, :scheduled_send_push)
      remove_column TABLE, :scheduled_by_id if column_exists?(TABLE, :scheduled_by_id)
      remove_column TABLE, :scheduled_for if column_exists?(TABLE, :scheduled_for)
    end
  end

  private

  # One transaction, so SET LOCAL and the DDL run on the same pooled session.
  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '#{LOCK_TIMEOUT}'"
      block.call
    end
  end
end
