require_relative "../support/model_coverage"

class MessageTest < ModelCoverageTestCase
  test "exactly one destination thread root and same destination are required" do
    item = Message.new(author: student, body: "Body")
    assert_not item.valid?
    item.channel = channel
    assert item.valid?
    item.direct_conversation = conversation
    assert_not item.valid?
    reply = Message.create!(channel: channel, author: student, parent_message: sample_message, body: "Reply")
    nested = Message.new(channel: channel, author: student, parent_message: reply)
    assert_not nested.valid?
    other = Channel.create!(workspace: course.workspace, name: "Other")
    assert_not Message.new(channel: other, author: student, parent_message: sample_message).valid?
  end

  test "client id normalization uniqueness source checks and soft deletion" do
    sample_message.update!(client_message_id: "  synthetic-id  ", mention_user_ids: [ student.id.to_s, student.id ])
    assert_equal "synthetic-id", sample_message.client_message_id
    assert_equal [ student.id ], sample_message.mention_user_ids
    second = Message.create!(channel: channel, author: student)
    assert_invalid second, :client_message_id, "synthetic-id"
    assert_database_rejects second, { client_message_id: "synthetic-id" }, ActiveRecord::RecordNotUnique, constraint: "idx_messages_on_author_and_client_message_id"
    assert_database_rejects second, { source_type: "Lesson", source_id: nil }, constraint: "messages_source_pair"
    assert_database_rejects second, { source_type: "User", source_id: student.id }, constraint: "messages_source_pair"
    sample_message.update!(deleted_at: Time.current)
    assert sample_message.deleted?
    assert_not Message.visible.exists?(sample_message.id)
    assert Message.exists?(sample_message.id)
    assert sample_message.editable_by?(student)
    assert sample_message.editable_by?(staff)
    assert_not sample_message.editable_by?(person)
  end

  test "destroy nullifies replies and cursors while deleting reactions and attachments" do
    reply = Message.create!(channel: channel, author: student, parent_message: sample_message)
    state = ChannelReadState.create!(channel: channel, user: student, last_read_message: sample_message)
    reaction = MessageReaction.create!(message: sample_message, user: student, emoji: "thumbsup")
    attachment = MessageAttachment.create!(message: sample_message, uploaded_by: student, s3_key: "synthetic", filename: "image.png", content_type: "image/png", byte_size: 10)
    sample_message.destroy!
    assert_nil reply.reload.parent_message_id
    assert_nil state.reload.last_read_message_id
    assert_not MessageReaction.exists?(reaction.id)
    assert_not MessageAttachment.exists?(attachment.id)
  end
end
