require "test_helper"
require "open3"
require "pg"
require "tempfile"

# Always local and disposable, even when the enclosing suite runs via PgBouncer.
class MigrationDatabaseProcessTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  setup do
    @database = "csg_pooler_safety_process_#{Process.pid}"
    @admin = PG.connect(host: "127.0.0.1", user: "postgres", password: "postgres", dbname: "postgres")
    @admin.exec("CREATE DATABASE #{@database}")
    @url = "postgresql://postgres:postgres@127.0.0.1:5432/#{@database}"
    @env = { "RAILS_ENV" => "production", "SECRET_KEY_BASE" => "local-test-only-" * 8,
      "DATABASE_URL" => @url + "?pgbouncer=TRUE", "MIGRATION_DATABASE_URL" => nil,
      "RAILS_LOG_LEVEL" => "fatal", "AWS_S3_BUCKET" => "", "AWS_ACCESS_KEY_ID" => "", "AWS_SECRET_ACCESS_KEY" => "" }
  end

  teardown do
    @admin&.exec("DROP DATABASE IF EXISTS #{@database} WITH (FORCE)")
    @admin&.close
  end

  test "real production prepare with valid secret uses direct locked connection" do
    @env["MIGRATION_DATABASE_URL"] = @url
    prepare_and_check(locks: true)
  end

  test "real production prepare rejects mismatched secret before schema load or seeds" do
    @env["MIGRATION_DATABASE_URL"] = @url.sub(@database, "postgres")
    _out, err, status = run_rails("db:prepare")
    refute status.success?
    assert_includes err, "Migration blocked"
    refute_includes err, @database
    PG.connect(@url) do |db|
      assert_nil db.exec("SELECT to_regclass('public.schema_migrations')").getvalue(0, 0)
    end
  end

  test "real production prepare without secret warns and disables migration locks only" do
    prepare_and_check(locks: false)
  end

  private

  def run_rails(*args)
    Open3.capture3(@env, Rails.root.join("bin/rails").to_s, *args)
  end

  def prepare_and_check(locks:)
    # schema:load exercises the same early guard and avoids seeds in the fixture.
    _out, _err, status = run_rails("db:schema:load")
    assert status.success?, "production schema load failed"
    probe = 'c = ActiveRecord::Base.connection; puts "POLICY:#{c.advisory_locks_enabled?}:#{c.prepared_statements}"'
    Tempfile.create([ "migration-policy", ".rb" ]) do |file|
      file.write("at_exit { #{probe} if defined?(ActiveRecord::Base) && !$! }")
      file.flush
      out, err, status = Open3.capture3(@env.merge("RUBYOPT" => "-r#{file.path}"), Rails.root.join("bin/rails").to_s, "db:prepare")
      assert status.success?, "production db:prepare failed"
      assert_equal !locks, err.include?("WARNING:")
      assert_includes out, "POLICY:#{locks}:false"
    end
    _out, _err, status = Open3.capture3(@env, "bundle", "exec", "rails", "db:prepare", chdir: Rails.root)
    assert status.success?, "exact native build migration command failed"
    %w[db:migrate:status db:rollback db:migrate].each do |task|
      _out, _err, status = run_rails(task)
      assert status.success?, "production emergency task failed"
    end
    PG.connect(@url) { |db| assert_equal "0", db.exec("SELECT count(*) FROM users").getvalue(0, 0) }
    # A fresh runtime process ignores the migration secret and keeps runtime locks.
    out, err, status = run_rails("runner", probe)
    assert status.success?, "runtime policy probe failed"
    assert_includes out, "POLICY:true:false"
    refute_includes err, "WARNING:"
  end
end
