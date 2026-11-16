# LearnerActivity asks for each learner's latest self-made event per cohort.
# Without a matching index Postgres reads every event in the selected cohorts
# (a bitmap or sequential scan whose cost grows with history). This partial
# index holds only learner-made learning events, so the query becomes an
# index-only scan over exactly the rows it aggregates.
#
# Pooler-safe (docs/DEPLOYMENT.md R-10): no DDL transaction, CONCURRENTLY, and
# a same-named index left invalid or with a different definition by an
# interrupted run is dropped and rebuilt; an exact valid one is kept.
class AddLearnerActivityIndex < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  NAME = "index_activity_events_on_learner_activity"
  COLUMNS = %w[subject_user_id cohort_id created_at].freeze
  # Frozen copy of LearnerActivity::EXCLUDED_EVENTS when this ran; a test
  # keeps the two in step so the query stays covered by the predicate.
  EXCLUDED_EVENTS = %w[account_signed_in submission_graded].freeze
  PREDICATE = "actor_id = subject_user_id AND event_type NOT IN (#{EXCLUDED_EVENTS.map { |type| "'#{type}'" }.join(", ")})".freeze
  # How Postgres 16 deparses PREDICATE (pg_get_expr), compared after normalizing.
  CANONICAL_PREDICATE = "((actor_id = subject_user_id) AND ((event_type)::text <> ALL ((ARRAY[" \
    "#{EXCLUDED_EVENTS.map { |type| "'#{type}'::character varying" }.join(", ")}])::text[])))".freeze

  def up
    index = connection.indexes(:activity_events).find { |candidate| candidate.name == NAME }
    identity = index && index.using == :btree && !index.unique && index.columns == COLUMNS &&
      index.orders.blank? && normalize(index.where) == normalize(CANONICAL_PREDICATE)
    valid = identity && connection.select_value(<<~SQL)
      SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass(#{connection.quote(NAME)})
    SQL
    return if valid

    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(NAME)}"
    execute "CREATE INDEX CONCURRENTLY #{connection.quote_table_name(NAME)} ON activity_events (#{COLUMNS.join(", ")}) WHERE #{PREDICATE}"
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(NAME)}"
  end

  private

  def normalize(sql)
    sql.to_s.downcase.gsub(/::character varying(\[\])?|::text(\[\])?/, "").gsub(/[()\s]/, "")
  end
end
