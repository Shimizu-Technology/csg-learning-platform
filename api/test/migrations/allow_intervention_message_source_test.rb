require "test_helper"
require Rails.root.join("db/migrate/20261117040600_allow_intervention_message_source").to_s
require Rails.root.join("db/migrate/20261117040700_validate_intervention_message_source").to_s

class AllowInterventionMessageSourceTest < ActiveSupport::TestCase
  test "widens the source constraint to follow-up plans, validates it, and rolls back cleanly" do
    allow = AllowInterventionMessageSource.new
    validate = ValidateInterventionMessageSource.new
    connection = Message.connection
    # Evaluates the live constraint against one candidate row, without writing a message.
    allowed = ->(type) do
      expression = connection.check_constraints(:messages).find { |candidate| candidate.name == "messages_source_pair" }.expression
      connection.select_value("SELECT (#{expression}) FROM (SELECT #{connection.quote(type)}::varchar AS source_type, 1::bigint AS source_id) AS candidate")
    end

    2.times do
      allow.migrate(:down)
      refute allowed.call("Intervention")
      assert allowed.call("HelpRequest")
      allow.migrate(:up)
      validate.migrate(:up)
      connection.schema_cache.clear!
      constraint = connection.check_constraints(:messages).find { |candidate| candidate.name == "messages_source_pair" }
      assert constraint&.validated?
      assert allowed.call("Intervention")
      refute allowed.call("User")
    end
  end
end
