class AddFanoutOutboxToAnnouncements < ActiveRecord::Migration[8.1]
  # Additive, constant defaults only. Historical publications have no intent;
  # deployment never replays them. Each DDL step and SET LOCAL share one
  # transaction on PgBouncer, with the same lock bound as the push outbox.
  disable_ddl_transaction!

  TABLE = :announcements
  INDEX = "index_announcements_on_fanout_pending"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :fanout_requested_at, :datetime unless column_exists?(TABLE, :fanout_requested_at)
      add_column TABLE, :fanout_settled_at, :datetime unless column_exists?(TABLE, :fanout_settled_at)
      add_column TABLE, :fanout_recipient_ids, :jsonb, default: [], null: false unless column_exists?(TABLE, :fanout_recipient_ids)
      add_column TABLE, :fanout_cursor, :bigint, default: 0, null: false unless column_exists?(TABLE, :fanout_cursor)
    end
    unless index_exists?(TABLE, :fanout_requested_at, name: INDEX)
      with_lock_timeout { add_index TABLE, :fanout_requested_at, name: INDEX, where: "fanout_requested_at IS NOT NULL AND fanout_settled_at IS NULL" }
    end
  end

  def down
    with_lock_timeout do
      remove_index TABLE, name: INDEX if index_exists?(TABLE, :fanout_requested_at, name: INDEX)
      %i[fanout_recipient_ids fanout_cursor fanout_settled_at fanout_requested_at].each do |column|
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
