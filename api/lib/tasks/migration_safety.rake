require_relative "../migration_database"

namespace :db do
  task :migration_connection_check do
    if Rails.env.production?
      MigrationDatabase.environment(ENV).each { |key, value| ENV[key] = value }
    end
  rescue MigrationDatabase::UnsafeConnection => error
    abort error.message
  end
end

# Prepend, rather than enhance: Rails' existing prerequisites load the database
# configuration. Guard destructive parent tasks before their db:drop prerequisite.
operations = %w[prepare migrate rollback forward schema:load setup reset]
Rake::Task.tasks.each do |task|
  if operations.any? { |operation| task.name == "db:#{operation}" || task.name.start_with?("db:#{operation}:") }
    task.prerequisites.unshift("db:migration_connection_check")
  end
end
