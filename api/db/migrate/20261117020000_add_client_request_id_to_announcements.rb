class AddClientRequestIdToAnnouncements < ActiveRecord::Migration[8.1]
  # Create dedupe for updates (PR #279 fix round 1). The composer sends a
  # client request id with each POST; a retry or a second click that reaches
  # the server returns the update the first request made instead of posting
  # (and notifying everyone) twice. The unique index is per author and only
  # covers rows that carry an id, so older clients that send none are
  # unaffected.
  #
  # Additive only. Each step runs in an explicit transaction with SET LOCAL
  # lock_timeout, so the timeout and the DDL share one session through Neon's
  # transaction-mode pooler (docs/DEPLOYMENT.md, migration rules). The table
  # holds a school's updates (hundreds of rows), so a plain index build inside
  # that short transaction is fine; CONCURRENTLY would need a session-level
  # connection the pooler does not give.
  disable_ddl_transaction!

  TABLE = :announcements
  INDEX = "index_announcements_on_author_and_client_request_id"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :client_request_id, :string, limit: 64 unless column_exists?(TABLE, :client_request_id)
    end
    with_lock_timeout do
      unless index_exists?(TABLE, [ :author_id, :client_request_id ], name: INDEX)
        add_index TABLE, [ :author_id, :client_request_id ], unique: true, name: INDEX, where: "client_request_id IS NOT NULL"
      end
    end
  end

  def down
    with_lock_timeout do
      remove_index TABLE, name: INDEX if index_exists?(TABLE, [ :author_id, :client_request_id ], name: INDEX)
      remove_column TABLE, :client_request_id if column_exists?(TABLE, :client_request_id)
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
