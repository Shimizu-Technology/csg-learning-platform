require "test_helper"

class MessageBroadcastServiceTest < ActiveSupport::TestCase
  test "created broadcasts channel messages only through per-user streams" do
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

    user_broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| user_broadcasts << [ target, payload ] }

    MessageBroadcastService.created(message)

    assert_equal 1, render_calls.size
    assert_equal message, render_calls.first[0]
    assert_equal author, render_calls.first[1][:current_user]
    assert_equal true, render_calls.first[1][:stream_url]
    assert_equal [ author ], user_broadcasts.map(&:first)
    assert_equal "created", user_broadcasts.first.second.fetch(:event)
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
    MessageJson.define_singleton_method(:render, original_render)
  end

  test "created hides blocked channel content in the recipient stream" do
    curriculum = Curriculum.create!(name: "Bootcamp 2028")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 5", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "blocked_broadcast_author", email: "blocked-author@example.com", first_name: "Blocked", last_name: "Author", role: :student)
    recipient = User.create!(clerk_id: "blocked_broadcast_recipient", email: "blocked-recipient@example.com", first_name: "Blocked", last_name: "Recipient", role: :student)
    Enrollment.create!(user: author, cohort: cohort, status: :active)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    # The author initiated the block. The blocked recipient must not receive
    # the author's content through the shared-channel realtime stream.
    UserBlock.create!(blocker: author, blocked_user: recipient)
    message = Message.create!(channel: channel, author: author, body: "Must not leak")

    user_broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| user_broadcasts << [ target, payload ] }

    MessageBroadcastService.created(message)

    author_payload = user_broadcasts.find { |target, _payload| target == author }.second.fetch(:message)
    recipient_payload = user_broadcasts.find { |target, _payload| target == recipient }.second.fetch(:message)
    assert_equal "Must not leak", author_payload.fetch(:body)
    assert_equal "", recipient_payload.fetch(:body)
    assert recipient_payload.fetch(:blocked)
    assert_empty recipient_payload.fetch(:attachments)
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
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

  test "delivery errors report the total failures and preserve the first cause" do
    curriculum = Curriculum.create!(name: "Broadcast failure curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Broadcast failure cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "broadcast_failure_author", email: "broadcast-failure-author@example.com", role: :admin)
    first_recipient = User.create!(clerk_id: "broadcast_failure_one", email: "broadcast-failure-one@example.com", role: :student)
    second_recipient = User.create!(clerk_id: "broadcast_failure_two", email: "broadcast-failure-two@example.com", role: :student)
    Enrollment.create!(user: first_recipient, cohort: cohort, status: :active)
    Enrollment.create!(user: second_recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Failure count")
    failures = {}
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) do |user, _payload|
      next if user == author

      failure = RuntimeError.new("recipient #{user.id} unavailable")
      failures[user.id] = failure
      raise failure
    end

    error = assert_raises(MessageBroadcastService::BroadcastFailures) do
      MessageBroadcastService.created(message, raise_on_failure: true)
    end

    assert_equal "2 recipient broadcast failures", error.message
    assert_same failures.values.first, error.cause
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
  end
end
