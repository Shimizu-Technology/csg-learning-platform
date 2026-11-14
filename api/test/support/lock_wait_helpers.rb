# Observe live heavyweight locks, not pg_stat_activity: PostgreSQL caches its
# activity snapshot for a transaction, so it can omit newly connected workers
# forever while our holder transaction stays open. Rails.uncached cannot refresh
# that server-side snapshot. pg_locks and pg_blocking_pids read live lock state.
module LockWaitHelpers
  def wait_for_lock_waiters(holder_pid, workers:, timeout: 60)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + timeout
    connection = ActiveRecord::Base.connection
    loop do
      # Include soft blockers (a request queued behind another request's tuple
      # lock), as well as requests directly waiting on the holder transaction.
      waiters = ActiveRecord::Base.uncached do
        connection.select_values(<<~SQL)
          WITH RECURSIVE waiters(pid) AS (
            SELECT pid FROM pg_locks
            WHERE NOT granted AND #{Integer(holder_pid)} = ANY(pg_blocking_pids(pid))
            UNION
            SELECT locks.pid FROM pg_locks locks
            JOIN waiters ON waiters.pid = ANY(pg_blocking_pids(locks.pid))
            WHERE NOT locks.granted
          )
          SELECT pid FROM waiters
        SQL
      end
      return if waiters.size >= workers.size

      completed = workers.reject(&:alive?)
      flunk "Worker completed before blocking on holder #{holder_pid}: #{completed.map(&:value).inspect}" if completed.any?
      # A monotonic deadline does not asynchronously interrupt a database query
      # (Timeout.timeout can leave an interrupted connection unusable).
      if Process.clock_gettime(Process::CLOCK_MONOTONIC) >= deadline
        locks = connection.select_all("SELECT pid, locktype, relation, transactionid, mode, granted FROM pg_locks WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database()) OR locktype = 'transactionid'").to_a
        flunk "Timed out after #{timeout}s waiting for #{workers.size} workers to block on holder #{holder_pid}; waiters=#{waiters.inspect}; locks=#{locks.inspect}"
      end
      sleep 0.01
    end
  end
end
