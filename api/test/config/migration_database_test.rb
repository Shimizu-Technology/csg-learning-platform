require "test_helper"
require "migration_database"
require "rake"

class MigrationDatabaseTest < ActiveSupport::TestCase
  RUNTIME = "postgresql://synthetic:private@ep-example-pooler.neon.tech/app"
  DIRECT = RUNTIME.sub("-pooler", "")

  test "all schema task guards precede environment and destructive prerequisites" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("db:migration_connection_check")
    %w[db:prepare db:migrate db:rollback db:forward db:migrate:status db:migrate:up db:migrate:down db:migrate:redo db:schema:load db:migrate:reset db:setup db:reset].each do |name|
      assert_equal "db:migration_connection_check", Rake::Task[name].prerequisites.first, name
    end
  end

  test "pooled fallback disables locks and warns on stderr" do
    assert_output(nil, /WARNING:.*single migration instance/) do
      selected = MigrationDatabase.environment({ "DATABASE_URL" => RUNTIME })
      assert_includes selected["DATABASE_URL"], "advisory_locks=false"
    end
  end

  test "direct secret must match runtime identity and retain locks" do
    selected = MigrationDatabase.environment({ "DATABASE_URL" => RUNTIME, "MIGRATION_DATABASE_URL" => DIRECT })
    assert_includes selected["DATABASE_URL"], "advisory_locks=true"
    [ DIRECT.sub("app", "neondb"), DIRECT.sub("synthetic", "other"), DIRECT.sub("ep-example", "ep-other"), RUNTIME,
      "postgresql://private secret@host/app", DIRECT + "?host=elsewhere", DIRECT + "?advisory_locks=FALSE" ].each do |direct|
      error = assert_raises(MigrationDatabase::UnsafeConnection) do
        MigrationDatabase.environment({ "DATABASE_URL" => RUNTIME, "MIGRATION_DATABASE_URL" => direct })
      end
      refute_includes error.message, "private"
      refute_includes error.message, "neon.tech"
    end
  end

  test "Rails boolean strings for pgbouncer and advisory locks" do
    %w[false FALSE TRUE].each do |value|
      assert_equal ActiveModel::Type::Boolean.new.cast(value), MigrationDatabase.boolean(value)
      runtime = DIRECT + "?pgbouncer=#{value}"
      output = StringIO.new
      selected = MigrationDatabase.environment({ "DATABASE_URL" => runtime }, output: output)
      assert_includes selected["DATABASE_URL"], "advisory_locks=#{value != 'TRUE'}"
      if value == "TRUE"
        assert_raises(MigrationDatabase::UnsafeConnection) do
          MigrationDatabase.environment({ "DATABASE_URL" => RUNTIME, "MIGRATION_DATABASE_URL" => runtime })
        end
      end
    end
    %w[false FALSE].each do |value|
      assert_raises(MigrationDatabase::UnsafeConnection) do
        MigrationDatabase.environment({ "DATABASE_URL" => RUNTIME, "MIGRATION_DATABASE_URL" => DIRECT + "?advisory_locks=#{value}" })
      end
    end
    assert_includes MigrationDatabase.environment({ "DATABASE_URL" => RUNTIME, "MIGRATION_DATABASE_URL" => DIRECT + "?advisory_locks=TRUE" })["DATABASE_URL"], "advisory_locks=true"
  end

  test "direct fallback keeps locks enabled even with a disabling URL option" do
    selected = MigrationDatabase.environment({ "DATABASE_URL" => DIRECT + "?advisory_locks=false" })
    assert_includes selected["DATABASE_URL"], "advisory_locks=true"
  end
end
