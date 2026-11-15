# Counts the SQL statements a block sends to the database, so tests can show
# that an endpoint's query count stays flat as the number of records grows.
# Schema lookups, transaction control and query-cache hits are not counted.
#
# Tests run inside the Rails executor, so the query cache stays enabled for the
# whole test and survives between requests (production clears it after each
# request). Clear it first so every measured request starts cold.
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
      next if payload[:cached] || IGNORED_NAMES.include?(payload[:name]) || payload[:sql].match?(IGNORED_SQL)

      queries << payload[:sql]
    end
    ActiveSupport::Notifications.subscribed(callback, "sql.active_record") { yield }
    queries
  end
end
