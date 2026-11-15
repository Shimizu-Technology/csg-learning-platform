require_relative "../support/model_coverage"

class MessageReadCursorTest < ModelCoverageTestCase
  test "after and through partition tied timestamps and seen matches the boundary" do
    first = sample_message
    second = Message.create!(channel: channel, author: student)
    scope = Message.where(id: [ first.id, second.id ])
    cursor = ChannelReadState.create!(user: student, channel: channel, last_read_message: first, last_read_at: first.created_at)
    assert_equal [ second.id ], MessageReadCursor.after(scope, cursor).ids
    assert_equal [ first.id ], MessageReadCursor.through(scope, cursor).ids
    assert MessageReadCursor.seen?(cursor, first)
    assert_not MessageReadCursor.seen?(cursor, second)
    assert MessageReadCursor.advances?(cursor, second.created_at, second)
    cursor.update!(last_read_message: nil)
    assert_empty MessageReadCursor.after(scope, cursor)
    assert_equal scope.ids.sort, MessageReadCursor.through(scope, cursor).ids.sort
    assert_raises(ArgumentError) { MessageReadCursor.after_joined(scope, "untrusted") }
  end
end
