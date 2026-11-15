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
      valid = connection.select_value(<<~SQL)
        SELECT indisvalid AND indisready FROM pg_index WHERE indexrelid = to_regclass(#{connection.quote(name)})
      SQL
      execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name(name)}" unless valid
      next if valid

      document = columns.map { |column| "coalesce(#{table}.#{column}, '')" }.join(" || ' ' || ")
      execute "CREATE INDEX CONCURRENTLY #{connection.quote_table_name(name)} ON #{connection.quote_table_name(table)} USING gin (to_tsvector('simple', #{document}))"
    end
  end

  def down
    FIELDS.each_key { |table| execute "DROP INDEX CONCURRENTLY IF EXISTS #{connection.quote_table_name("index_#{table}_search_document")}" }
  end
end
