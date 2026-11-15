require_relative "../support/model_coverage"

class DirectConversationMemberTest < ModelCoverageTestCase
  test "read cursor advances monotonically and breaks equal time ties by message id" do
    state = conversation.direct_conversation_members.find_by!(user: student)
    first = Message.create!(direct_conversation: conversation, author: student, body: "Direct")
    second = first.dup
    second.save!
    state.mark_read!(second)
    state.mark_read!(first)
    assert_equal second.id, state.reload.last_read_message_id
    assert_equal second.created_at, state.last_read_at
    later = second.created_at + 1.hour
    state.update!(last_read_at: later)
    state.mark_read!(first)
    assert_equal later, state.reload.last_read_at
    assert_not state.dup.valid?
  end
end
