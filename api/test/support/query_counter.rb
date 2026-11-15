# Counts logical SQL queries (including cache hits), so tests can show
# that an endpoint's query count stays flat as the number of records grows.
# Schema lookups and transaction control are not counted.
#
# Include query-cache hits: batch preloads may request the same IDs in the
# same order at size one but a different order at size five. Ignoring the cached
# read makes the count depend on unspecified database row order. Counting all
# logical reads also catches repeated per-record lookups hidden by the cache.
# Clear it first so each measured request still starts cold.
module QueryCounter
  IGNORED_NAMES = %w[SCHEMA TRANSACTION].freeze
  IGNORED_SQL = /\A\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/i

  def count_queries(&block)
    queries = capture_queries(&block)
    queries.size
  end

  def capture_queries
    ActiveRecord::Base.connection_pool.clear_query_cache
    queries = []
    callback = lambda do |*, payload|
      next if IGNORED_NAMES.include?(payload[:name]) || payload[:sql].match?(IGNORED_SQL)

      queries << payload[:sql]
    end
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    queries
  end
end
