require "pg"
require "uri"

# Prepared migration round trips deliberately change result shapes. Like direct production
# migrations, run their DDL on the direct connection, then invalidate PgBouncer's
# server plans before runtime tests resume. Clearing only Rails' local statement
# pool does not clear plans cached on the other transaction-pool backends.
# The unprepared leg retains the production pooled-migration fallback path.
module PoolerMigrationConnections
  def before_setup
    if ENV["POOLER_CANARY"] == "1"
      expected_port = URI.parse(ENV.fetch("DATABASE_URL")).port
      raise "Runtime tests must resume through PgBouncer" unless ActiveRecord::Base.connection_db_config.configuration_hash[:port] == expected_port
    end
    if ENV["POOLER_CANARY"] == "1" && ENV["EXPECTED_PREPARED_STATEMENTS"] == "true" && File.expand_path(self.class.instance_method(name).source_location.first, Rails.root).start_with?(Rails.root.join("test/migrations/").to_s)
      @pooler_runtime_config = ActiveRecord::Base.connection_db_config.configuration_hash
      direct = URI.parse(ENV.fetch("POOLER_DIRECT_DATABASE_URL"))
      unless %w[postgres postgresql].include?(direct.scheme) && %w[127.0.0.1 localhost].include?(direct.host) && direct.path == "/#{@pooler_runtime_config.fetch(:database)}"
        raise "Pooler migration tests require a direct local connection to the same disposable database"
      end
      # Preserve the matrix's prepared-statement setting on the direct adapter.
      ActiveRecord::Base.establish_connection(@pooler_runtime_config.merge(host: direct.host, port: direct.port || 5432))
    end
    super
  end

  def after_teardown
    super
  ensure
    if @pooler_runtime_config
      # The fixture transaction has rolled back by now. Disconnecting the direct
      # adapter clears its statement pool, then RECONNECT clears all pooler server
      # plans (including backends that this Rails client never happened to use).
      ActiveRecord::Base.establish_connection(@pooler_runtime_config)
      database = @pooler_runtime_config.fetch(:database)
      raise "Unexpected disposable database name" unless database.match?(/\Acsg_[a-z0-9_]+\z/)

      PG.connect(host: @pooler_runtime_config.fetch(:host), port: @pooler_runtime_config.fetch(:port),
        user: @pooler_runtime_config[:username], password: @pooler_runtime_config[:password], dbname: "pgbouncer") do |admin|
        admin.exec("RECONNECT #{database}")
        admin.exec("WAIT_CLOSE #{database}")
      end
    end
  end
end

ActiveSupport::TestCase.prepend(PoolerMigrationConnections)
