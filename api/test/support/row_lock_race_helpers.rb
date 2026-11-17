require "timeout"

# Runs work on a second database connection while the test holds (or waits
# for) a row lock, as another request or a scheduled tick would. Tests that
# include it set `@threads = []` in setup and finish those threads in teardown
# (NonTransactionalTestCleanup#finish_test_threads).
module RowLockRaceHelpers
  def in_thread(&block)
    backend = Queue.new
    thread = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        worker = Thread.current
        # PgBouncer can hand each transaction a different backend, and lend a
        # backend to another client between transactions, so a PID alone can't
        # identify the competing write. Each transaction's virtual transaction
        # id can: it is unique per transaction, and a waiting lock row carries
        # its transaction's id. It is read right after each BEGIN.
        capture_transaction = lambda do
          worker[:vxid] = ActiveRecord::Base.uncached do
            connection.select_value("SELECT virtualtransaction FROM pg_locks WHERE locktype = 'virtualxid' AND pid = pg_backend_pid() AND granted")
          end
        end
        backend << true
        on_begin = lambda do |*, payload|
          capture_transaction.call if Thread.current == worker && payload[:sql].match?(/\ABEGIN\b/)
        end
        ActiveSupport::Notifications.subscribed(on_begin, "sql.active_record") { block.call(connection) }
      end
    end
    @threads << thread
    Timeout.timeout(30) { backend.pop }
    thread
  end

  def on_second_connection(&block)
    Timeout.timeout(30) { in_thread(&block).value }
  end


  # The other request either finished (it didn't need the row) or is waiting
  # for a lock this request holds. The request's query cache is bypassed so
  # each check reads pg_locks afresh.
  def wait_until_blocked_or_done(thread)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 15
    loop do
      return unless thread.alive?
      # Only a lock the other request's own transaction is waiting for counts;
      # before its first BEGIN there is nothing to match.
      if (vxid = thread[:vxid])
        connection = ActiveRecord::Base.connection
        waiting = ActiveRecord::Base.uncached { connection.select_value("SELECT count(*) FROM pg_locks WHERE NOT granted AND virtualtransaction = #{connection.quote(vxid)}") }
        return if waiting.to_i.positive?
      end
      if Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline
        flunk "the other request neither finished nor waited for a lock:\n#{thread.backtrace&.first(40)&.join("\n")}"
      end

      sleep 0.02
    end
  end
end
