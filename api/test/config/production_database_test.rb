require "test_helper"
require "erb"
require "yaml"
require "migration_database"

class ProductionDatabaseTest < ActiveSupport::TestCase
  test "production preserves runtime URL and pool with or without migration URL" do
    [ nil, "postgresql://direct.example.test/unused" ].each do |direct|
      with_env("DATABASE_URL" => "postgresql://runtime-pooler.example.test/app", "MIGRATION_DATABASE_URL" => direct, "RAILS_MAX_THREADS" => "7") do
        config = production_config
        assert_equal "runtime-pooler.example.test", config[:host]
        assert_equal false, config[:prepared_statements]
        assert_equal true, config[:advisory_locks]
        assert_equal 7, config[:max_connections]
      end
    end
  end

  test "production defaults to five connections when thread count is unset" do
    with_env("RAILS_MAX_THREADS" => nil) do
      assert_equal 5, production_config[:max_connections]
    end
  end

  test "pooler CI matches the explicit production prepared statement policy" do
    # Do not let the CI URL's query string mask the YAML policy. Rails keeps
    # URL boolean options as strings until the adapter casts them.
    with_env("DATABASE_URL" => "postgresql://runtime-pooler.example.test/app") do
      assert_equal false, production_config[:prepared_statements]
    end
    if ActiveRecord::Base.connection_db_config.configuration_hash[:port] == 16432
      refute ActiveRecord::Base.connection.prepared_statements
    end
  end

  private

  def production_config
    yaml = YAML.safe_load(ERB.new(Rails.root.join("config/database.yml").read).result, aliases: true)
    ActiveRecord::DatabaseConfigurations.new(yaml).configs_for(env_name: "production", name: "primary").configuration_hash
  end

  def with_env(values)
    previous = values.to_h { |key, _| [ key, ENV[key] ] }
    values.each { |key, value| ENV[key] = value }
    yield
  ensure
    previous.each { |key, value| ENV[key] = value }
  end
end
