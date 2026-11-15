require_relative "../support/model_coverage"

class DirectConversationMemberTest < ModelCoverageTestCase
  test "read cursor advances monotonically and breaks equal time ties by message id" do
    state = conversation.direct_conversation_members.find_by!(user: student)
    first = Message.create!(direct_conversation: conversation, author: student, body: "Direct")
    second = first.dup
    second.save!
    assert_equal first.created_at, second.created_at
    assert_operator first.id, :<, second.id
    state.mark_read!(first)
    assert_equal first.id, state.reload.last_read_message_id
    # Same timestamp, higher id: the cursor moves forward to the later message.
    state.mark_read!(second)
    assert_equal second.id, state.reload.last_read_message_id
    assert_equal second.created_at, state.last_read_at
    # Re-reading the earlier message at the same timestamp never moves it back.
    state.mark_read!(first)
    assert_equal second.id, state.reload.last_read_message_id
    later = second.created_at + 1.hour
    state.update!(last_read_at: later)
    state.mark_read!(first)
    assert_equal later, state.reload.last_read_at
    assert_not state.dup.valid?
  end
end
