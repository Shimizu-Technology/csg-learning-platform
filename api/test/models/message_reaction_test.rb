require_relative "../support/model_coverage"

class MessageReactionTest < ModelCoverageTestCase
  test "reactions are unique per message user and emoji but allow other emoji" do
    row = MessageReaction.create!(user: student, message: sample_message, emoji: "yes")
    assert_not row.dup.valid?
    assert_invalid row, :emoji, ""
    assert_invalid row, :emoji, "x" * 33
    other = MessageReaction.create!(user: student, message: sample_message, emoji: "no")
    assert_database_rejects other, { emoji: "yes" }, ActiveRecord::RecordNotUnique
  end
end
