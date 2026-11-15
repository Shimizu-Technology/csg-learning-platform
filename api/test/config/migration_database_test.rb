require "test_helper"
require "migration_database"
require "rake"
require "open3"

class MigrationDatabaseTest < ActiveSupport::TestCase
  test "production migration tasks reject a pooled fallback before running DDL" do
    Rails.application.load_tasks unless Rake::Task.task_defined?("db:migration_connection_check")
    %w[db:prepare db:migrate db:rollback db:migrate:up db:migrate:down db:migrate:redo].each do |name|
      assert_includes Rake::Task[name].prerequisites, "db:migration_connection_check"
    end
    configs = ActiveRecord::DatabaseConfigurations.new("production" => {
      "primary" => { "adapter" => "postgresql", "host" => "ep-example-pooler.neon.tech", "advisory_locks" => true }
    })
    original_env = Rails.method(:env)
    original_configs = ActiveRecord::Base.method(:configurations)
    Rails.define_singleton_method(:env) { ActiveSupport::EnvironmentInquirer.new("production") }
    ActiveRecord::Base.define_singleton_method(:configurations) { configs }
    assert_output(nil, /Migration blocked/) do
      error = assert_raises(SystemExit) { Rake::Task["db:migration_connection_check"].execute }
      assert_equal 1, error.status
    end
  ensure
    Rails.define_singleton_method(:env, original_env) if original_env
    ActiveRecord::Base.define_singleton_method(:configurations, original_configs) if original_configs
  end

  test "deploy command rejects absent direct URL and malformed overrides before Rails boots" do
    [ nil, "postgresql://synthetic:private secret@direct.example.test/app" ].each do |direct|
      output, status = Open3.capture2e(
        { "DATABASE_URL" => "postgresql://synthetic:private@ep-example-pooler.neon.tech/app", "MIGRATION_DATABASE_URL" => direct },
        Rails.root.join("bin/migrate").to_s
      )
      refute status.success?
      assert_includes output, "Migration blocked"
      refute_includes output, "private"
      refute_includes output, "neon.tech"
    end
  end

  test "pooler hosts and query markers are rejected without leaking connection details" do
    [
      { host: "ep-example-pooler.neon.tech" },
      { host: "PGBOUNCER.example.test" },
      { url: "postgresql://synthetic:private@direct.example.test/app?pgbouncer=true" },
      { host: "direct.example.test", pgbouncer: "true" }
    ].each do |config|
      output = StringIO.new
      error = assert_raises(MigrationDatabase::UnsafeConnection) { MigrationDatabase.verify!(config, output: output) }
      assert_includes error.message, "MIGRATION_DATABASE_URL"
      assert_empty output.string
      refute_includes error.message, "private"
      refute_includes error.message, "example.test"
    end
  end

  test "direct connection retains advisory locks and logs no host" do
    output = StringIO.new
    MigrationDatabase.verify!({ host: "direct.example.test", advisory_locks: true }, output: output)
    assert_includes output.string, "check passed"
    refute_includes output.string, "example.test"
  end

  test "explicitly disabled advisory locks are distinguished" do
    output = StringIO.new
    MigrationDatabase.verify!({ host: "ep-example-pooler.neon.tech", advisory_locks: false }, output: output)
    assert_includes output.string, "advisory locks disabled"
  end

  test "malformed URLs fail with redacted errors" do
    error = assert_raises(MigrationDatabase::UnsafeConnection) do
      MigrationDatabase.verify!({ url: "postgresql://private secret@host/app" })
    end
    refute_includes error.message, "private"
  end
end
