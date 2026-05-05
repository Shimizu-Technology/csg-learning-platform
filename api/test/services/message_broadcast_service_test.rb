require "test_helper"

class MessageBroadcastServiceTest < ActiveSupport::TestCase
  test "created broadcasts messages with stream urls enabled" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "broadcast_author", email: "broadcast-author@example.com", first_name: "Broadcast", last_name: "Author", role: :admin)
    message = Message.create!(channel: channel, author: author, body: "Streaming attachments")

    render_calls = []
    original_render = MessageJson.method(:render)
    MessageJson.define_singleton_method(:render) do |record, **kwargs|
      render_calls << [ record, kwargs ]
      { id: record.id }
    end

    original_broadcast = ChannelMessagesChannel.method(:broadcast_to)
    ChannelMessagesChannel.define_singleton_method(:broadcast_to) { |_target, _payload| nil }
    user_broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| user_broadcasts << [ target, payload ] }

    MessageBroadcastService.created(message)

    assert_equal 2, render_calls.size
    assert_equal message, render_calls.first[0]
    assert_equal true, render_calls.first[1][:stream_url]
    assert_equal author, render_calls.second[1][:current_user]
    assert_equal true, render_calls.second[1][:stream_url]
    assert_equal [ author ], user_broadcasts.map(&:first)
    assert_equal "created", user_broadcasts.first.second.fetch(:event)
  ensure
    ChannelMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
    MessageJson.define_singleton_method(:render, original_render)
  end

  test "created broadcasts direct messages to each member user stream" do
    curriculum = Curriculum.create!(name: "Bootcamp 2027")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 4", start_date: Date.current, status: :active)
    workspace = cohort.workspace
    author = User.create!(clerk_id: "dm_broadcast_author", email: "dm-author@example.com", first_name: "DM", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "dm_broadcast_recipient", email: "dm-recipient@example.com", first_name: "DM", last_name: "Recipient", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    conversation = DirectConversation.find_or_create_for!(workspace: workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "First direct message")

    original_broadcast = DirectMessagesChannel.method(:broadcast_to)
    DirectMessagesChannel.define_singleton_method(:broadcast_to) { |_target, _payload| nil }
    user_broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| user_broadcasts << [ target, payload ] }

    MessageBroadcastService.created(message)

    assert_equal [ author, recipient ].sort_by(&:id), user_broadcasts.map(&:first).sort_by(&:id)
    recipient_payload = user_broadcasts.find { |target, _payload| target == recipient }.second
    assert_equal "created", recipient_payload.fetch(:event)
    assert_equal conversation.id, recipient_payload.fetch(:direct_conversation_id)
    assert_equal conversation.id, recipient_payload.fetch(:direct_conversation).fetch(:id)
    assert_equal message.id, recipient_payload.fetch(:message).fetch(:id)
  ensure
    DirectMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
  end
end
