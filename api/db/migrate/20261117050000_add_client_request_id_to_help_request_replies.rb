# Retry dedupe for help-request replies (PR #282 fix round 1), as #279 did for
# updates. Web and mobile send a client request id with each reply attempt and
# reuse it on retry; a retry whose first attempt was saved returns that reply
# instead of saving it, and pushing the learner, twice. The unique index is
# per request and author and only covers rows that carry an id, so installed
# clients that send none are unaffected.
#
# Additive only. Each step runs in its own transaction with SET LOCAL
# lock_timeout, so the timeout and the DDL share one session through Neon's
# transaction-mode pooler. The table is new and small, so a plain index build
# inside that short transaction is fine.
class AddClientRequestIdToHelpRequestReplies < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  TABLE = :help_request_replies
  COLUMNS = [ :help_request_id, :author_id, :client_request_id ].freeze
  INDEX = "index_help_request_replies_on_client_request"
  LOCK_TIMEOUT = "5s"

  def up
    with_lock_timeout do
      add_column TABLE, :client_request_id, :string, limit: 64 unless column_exists?(TABLE, :client_request_id)
    end
    with_lock_timeout do
      add_index TABLE, COLUMNS, unique: true, name: INDEX, where: "client_request_id IS NOT NULL" unless index_exists?(TABLE, COLUMNS, name: INDEX)
    end
  end

  def down
    with_lock_timeout do
      remove_index TABLE, name: INDEX if index_exists?(TABLE, COLUMNS, name: INDEX)
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
