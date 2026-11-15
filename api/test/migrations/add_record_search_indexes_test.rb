require "test_helper"
require_relative "../../db/migrate/20261116100000_add_record_search_indexes"

class AddRecordSearchIndexesTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "reuses the exact index and repairs a same-named wrong definition" do
    connection = ActiveRecord::Base.connection
    migration = AddRecordSearchIndexes.new
    name = "index_users_search_document"
    oid = -> { connection.select_value("SELECT to_regclass('#{name}')::oid") }
    migration.up
    original = oid.call
    migration.up
    assert_equal original, oid.call, "valid expected index should survive a retry"

    [ "CREATE INDEX #{name} ON users (id)",
      "CREATE INDEX #{name} ON users USING gin (to_tsvector('simple', coalesce(email, '')))",
      "CREATE INDEX #{name} ON users USING gin (to_tsvector('simple', coalesce(first_name, ''))) WHERE archived_at IS NULL" ].each do |definition|
      connection.execute("DROP INDEX #{name}")
      connection.execute(definition)
      wrong = oid.call
      migration.up
      refute_equal wrong, oid.call
      index = connection.indexes(:users).find { |candidate| candidate.name == name }
      assert_equal :gin, index.using
      assert_nil index.where
      assert_includes index.columns, "last_name"
      assert_includes index.columns, "handle"
    end
  ensure
    migration&.up
  end
end
