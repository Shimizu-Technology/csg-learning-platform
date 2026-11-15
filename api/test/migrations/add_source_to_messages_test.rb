require "test_helper"
require Rails.root.join("db/migrate/20261115100000_add_source_to_messages").to_s
require Rails.root.join("db/migrate/20261115100100_validate_messages_source_pair").to_s

class AddSourceToMessagesTest < ActiveSupport::TestCase
  test "adds a validated source pair to messages and rolls back cleanly" do
    add = AddSourceToMessages.new
    validate = ValidateMessagesSourcePair.new
    connection = Message.connection
    2.times do
      add.migrate(:down)
      refute connection.column_exists?(:messages, :source_type)
      refute connection.column_exists?(:messages, :source_id)
      refute connection.check_constraint_exists?(:messages, name: "messages_source_pair")
      add.migrate(:up)
      add.migrate(:up)
      validate.migrate(:up)
      connection.schema_cache.clear!
      columns = connection.columns(:messages).index_by(&:name)
      assert_equal [ :string, 32 ], [ columns.fetch("source_type").type, columns.fetch("source_type").limit ]
      assert_equal :integer, columns.fetch("source_id").type
      assert_equal 8, columns.fetch("source_id").limit
      constraint = connection.check_constraints(:messages).find { |candidate| candidate.name == "messages_source_pair" }
      assert constraint&.validated?
    end
    Message.reset_column_information
  end
end
