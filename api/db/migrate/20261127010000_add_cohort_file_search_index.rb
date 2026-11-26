class AddCohortFileSearchIndex < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  INDEX_NAME = "index_cohort_files_search_document"
  COLUMNS = %w[title filename folder].freeze

  def up
    table = :cohort_files
    document = COLUMNS.map { |column| "coalesce(cohort_files.#{column}, '')" }.join(" || ' ' || ")
    expected = COLUMNS.map { |column| "COALESCE(#{column}, ''::#{connection.columns(table).find { |c| c.name == column }.sql_type.sub(/\(\d+\)/, "")})" }.join(" || ' '::text || ")
    index = connection.indexes(table).find { |candidate| candidate.name == INDEX_NAME }
    normalize = ->(value) { value.to_s.downcase.gsub(/::character varying|::text/, "").scan(/'(?:[^']|'')*'|[^()\s"']+/).join }
    identity = index && index.using == :gin && !index.unique && index.where.nil? &&
      normalize.call(index.columns) == normalize.call("to_tsvector('simple'::regconfig, #{expected})")
    valid = identity && connection.select_value(<<~SQL)
      SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass(#{connection.quote(INDEX_NAME)})
    SQL
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}" unless valid
    return if valid

    execute "CREATE INDEX CONCURRENTLY #{connection.quote_table_name(INDEX_NAME)} ON #{connection.quote_table_name(table)} USING gin (to_tsvector('simple', #{document}))"
  end

  def down
    execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(INDEX_NAME)}"
  end
end
