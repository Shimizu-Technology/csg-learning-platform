require "test_helper"

class HealthTest < ActionDispatch::IntegrationTest
  test "health reports process liveness without touching the database" do
    original_connection = ActiveRecord::Base.method(:connection)
    ActiveRecord::Base.define_singleton_method(:connection) do
      raise "health must not connect to the database"
    end

    get "/health"

    assert_response :success
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_equal({ "status" => "ok" }, JSON.parse(response.body))
  ensure
    ActiveRecord::Base.define_singleton_method(:connection, original_connection) if original_connection
  end

  test "readiness checks dependencies without exposing internals" do
    get "/ready"

    assert_response :success
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_equal(
      {
        "status" => "ok",
        "checks" => { "database" => "ok", "queue" => "not_required" }
      },
      JSON.parse(response.body)
    )
  end

  test "readiness returns service unavailable when the database is unavailable" do
    unavailable_connection = Object.new
    unavailable_connection.define_singleton_method(:select_value) do |_query|
      raise ActiveRecord::ConnectionNotEstablished, "database host with sensitive details"
    end

    original_connection = ActiveRecord::Base.method(:connection)
    ActiveRecord::Base.define_singleton_method(:connection) { unavailable_connection }
    get "/ready"

    assert_response :service_unavailable
    assert_equal "no-store", response.headers["Cache-Control"]
    assert_equal(
      { "status" => "unavailable", "checks" => { "database" => "failed" } },
      JSON.parse(response.body)
    )
    assert_not_includes response.body, "sensitive"
  ensure
    ActiveRecord::Base.define_singleton_method(:connection, original_connection) if original_connection
  end
end
