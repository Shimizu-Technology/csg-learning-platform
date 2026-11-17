# Staff replies to a help request (U-4.7). A reply can keep the request open
# or resolve it; help_requests.staff_response keeps the latest reply's text
# for installed clients that read only that field.
#
# Requests answered before replies existed get their one response copied in
# as a reply, by the staff member who resolved it (the request's owner) at
# the time it was resolved. The copy is idempotent: a request that already
# has any reply is skipped, so re-running the migration adds nothing.
# Requests with no owner left (the account was removed) keep their
# staff_response only; every client still shows it.
#
# Each step is its own short transaction with SET LOCAL lock_timeout, so the
# timeout and the statement share one session through Neon's transaction-mode
# pooler (docs/DEPLOYMENT.md, migration rules), and the backfill runs in id
# batches instead of holding one long transaction.
class CreateHelpRequestReplies < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  TABLE = :help_request_replies
  THREAD_INDEX = "index_help_request_replies_thread"
  LOCK_TIMEOUT = "5s"
  BATCH = 1_000

  def up
    with_lock_timeout do
      unless table_exists?(TABLE)
        create_table TABLE do |t|
          t.references :help_request, null: false, foreign_key: true, index: false
          t.references :author, null: false, foreign_key: { to_table: :users }
          t.text :body, null: false
          t.boolean :resolved_request, null: false, default: false
          t.timestamps
        end
      end
    end
    with_lock_timeout do
      add_index TABLE, [ :help_request_id, :created_at ], name: THREAD_INDEX unless index_exists?(TABLE, [ :help_request_id, :created_at ], name: THREAD_INDEX)
    end
    backfill_existing_responses
  end

  def down
    with_lock_timeout { drop_table TABLE, if_exists: true }
  end

  private

  def backfill_existing_responses
    first, last = select_rows("SELECT MIN(id), MAX(id) FROM help_requests").first.map { |value| value&.to_i }
    return unless first

    (first..last).step(BATCH) do |start|
      with_lock_timeout do
        execute <<~SQL.squish
          INSERT INTO help_request_replies (help_request_id, author_id, body, resolved_request, created_at, updated_at)
          SELECT requests.id, requests.owner_id, requests.staff_response, requests.status = 2,
                 COALESCE(requests.resolved_at, requests.acknowledged_at, requests.updated_at),
                 COALESCE(requests.resolved_at, requests.acknowledged_at, requests.updated_at)
          FROM help_requests requests
          WHERE requests.id BETWEEN #{start.to_i} AND #{(start + BATCH - 1).to_i}
            AND requests.owner_id IS NOT NULL
            AND requests.staff_response IS NOT NULL
            AND btrim(requests.staff_response) <> ''
            AND NOT EXISTS (SELECT 1 FROM help_request_replies replies WHERE replies.help_request_id = requests.id)
        SQL
      end
    end
  end

  # One transaction, so SET LOCAL and the statement run on the same pooled session.
  def with_lock_timeout(&block)
    transaction do
      execute "SET LOCAL lock_timeout = '#{LOCK_TIMEOUT}'"
      block.call
    end
  end
end
