require_relative "../migration_database"

namespace :db do
  task migration_connection_check: :environment do
    if Rails.env.production?
      ActiveRecord::Base.configurations.configs_for(env_name: Rails.env).each do |config|
        MigrationDatabase.verify!(config.configuration_hash)
      end
    end
  rescue MigrationDatabase::UnsafeConnection => error
    abort error.message
  end
end

# Also protect manual commands that bypass bin/migrate. Check before any DDL,
# including db:prepare's initial schema load on a newly created database.
%w[db:prepare db:migrate db:rollback db:migrate:up db:migrate:down db:migrate:redo].each do |name|
  Rake::Task[name].enhance([ "db:migration_connection_check" ])
end
