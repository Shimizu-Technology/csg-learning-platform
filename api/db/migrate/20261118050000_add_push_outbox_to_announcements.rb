class AddPushOutboxToAnnouncements < ActiveRecord::Migration[8.1]
  # A durable push intent for posted updates (#299 review, P1). Posting with
  # push sets `push_requested_at` in the same UPDATE that posts the update, so
  # the intent commits with the post. PushNotificationJob claims each
  # recipient's notification per provider under the announcement's row lock
  # (`web_push_attempted_notification_ids`, `expo_push_attempted_notification_ids`,
  # as messages already do) before sending, and sets `push_settled_at` once
  # every recipient has been claimed by both providers. The hourly tick
  # re-requests the push for posted updates still unsettled after a short
  # grace period, so a process that dies between the commit and the push no
  # longer loses it, and a retry only sends to recipients not yet claimed.
  #
  # Additive only, so the previous release keeps working during rollout: the
  # timestamps are nullable and the claim lists default to empty arrays (a
  # constant default, so no table rewrite). Existing updates have no intent
  # and are never re-pushed. Each step runs in an explicit transaction with
  # SET LOCAL lock_timeout, so the timeout and the DDL share one session
  # through Neon's transaction-mode pooler (docs/DEPLOYMENT.md). The partial
  # index is what the tick reads; the table holds hundreds of rows, so it is
  # built in the transaction rather than concurrently.
  disable_ddl_transaction!

  TABLE = :announcements
  INDEX = "index_announcements_on_push_pending"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :push_requested_at, :datetime unless column_exists?(TABLE, :push_requested_at)
      add_column TABLE, :push_settled_at, :datetime unless column_exists?(TABLE, :push_settled_at)
      add_column TABLE, :web_push_attempted_notification_ids, :jsonb, default: [], null: false unless column_exists?(TABLE, :web_push_attempted_notification_ids)
      add_column TABLE, :expo_push_attempted_notification_ids, :jsonb, default: [], null: false unless column_exists?(TABLE, :expo_push_attempted_notification_ids)
    end
    unless index_exists?(TABLE, :push_requested_at, name: INDEX)
      with_lock_timeout { add_index TABLE, :push_requested_at, name: INDEX, where: "push_requested_at IS NOT NULL AND push_settled_at IS NULL" }
    end
  end

  def down
    with_lock_timeout do
      remove_index TABLE, name: INDEX if index_exists?(TABLE, :push_requested_at, name: INDEX)
      %i[expo_push_attempted_notification_ids web_push_attempted_notification_ids push_settled_at push_requested_at].each do |column|
        remove_column TABLE, column if column_exists?(TABLE, column)
      end
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
