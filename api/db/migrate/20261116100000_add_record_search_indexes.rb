class AddRecordSearchIndexes < ActiveRecord::Migration[8.1]
  disable_ddl_transaction!

  # Frozen migration expressions: do not depend on future application code.
  FIELDS = {
    users: %w[first_name last_name handle], cohorts: %w[name],
    curricula: %w[name description], modules: %w[name description], lessons: %w[title],
    submissions: %w[text notes], help_requests: %w[context_label message],
    interventions: %w[action_summary], channels: %w[name description], messages: %w[body],
    announcements: %w[title body], recordings: %w[title description],
    curriculum_resources: %w[title filename]
  }.freeze

  def up
    FIELDS.each do |table, columns|
      name = "index_#{table}_search_document"
      document = columns.map { |column| "coalesce(#{table}.#{column}, '')" }.join(" || ' ' || ")
      # Compare the expression as well as index method, predicate and uniqueness.
      expected = columns.map { |column| "COALESCE(#{column}, ''::#{connection.columns(table).find { |c| c.name == column }.sql_type.sub(/\(\d+\)/, "")})" }.join(" || ' '::text || ")
      index = connection.indexes(table).find { |candidate| candidate.name == name }
      normalize = ->(value) { value.to_s.downcase.gsub(/::character varying|::text/, "").scan(/'(?:[^']|'')*'|[^()\s"']+/).join }
      identity = index && index.using == :gin && !index.unique && index.where.nil? &&
        normalize.call(index.columns) == normalize.call("to_tsvector('simple'::regconfig, #{expected})")
      valid = identity && connection.select_value(<<~SQL)
        SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass(#{connection.quote(name)})
      SQL
      execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(name)}" unless valid
      next if valid

      execute "CREATE INDEX CONCURRENTLY #{connection.quote_table_name(name)} ON #{connection.quote_table_name(table)} USING gin (to_tsvector('simple', #{document}))"
    end
  end

  def down
    FIELDS.each_key { |table| execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name("index_#{table}_search_document")}" }
  end
end
