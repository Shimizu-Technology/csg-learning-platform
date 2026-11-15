require "test_helper"
require_relative "../support/query_counter"

class QueryCounterTest < ActiveSupport::TestCase
  include QueryCounter

  test "identical batch reads are counted even inside an enabled query cache" do
    connection = ActiveRecord::Base.connection
    ActiveRecord::Base.cache do
      assert connection.query_cache_enabled
      assert_equal 2, count_queries {
        2.times { connection.select_value("SELECT 1 AS query_counter_regression") }
      }
      assert connection.query_cache_enabled
    end
  end

  test "batch order cannot change the count through an accidental cache hit" do
    connection = ActiveRecord::Base.connection
    first = "SELECT n FROM (VALUES (1), (2)) AS batch(n) WHERE n IN (1, 2)"
    reversed = "SELECT n FROM (VALUES (1), (2)) AS batch(n) WHERE n IN (2, 1)"
    ActiveRecord::Base.cache do
      counts = [ first, reversed ].map do |second|
        count_queries do
          connection.select_all(first)
          connection.select_all(second)
        end
      end
      assert_equal [ 2, 2 ], counts
    end
  end
end
