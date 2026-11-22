require "test_helper"
require_relative "../support/query_counter"

class MessageBroadcastServiceTest < ActiveSupport::TestCase
  include QueryCounter
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

  test "non-peer-space channel broadcasts omit can_post and post_disabled_reason" do
    curriculum = Curriculum.create!(name: "Regular Broadcast Curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Regular Cohort", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    student = User.create!(clerk_id: "regular_broadcast_student", email: "regular-broadcast-student@example.com", role: :student)
    Enrollment.create!(user: student, cohort: cohort, status: :active)
    message = Message.create!(channel: channel, author: student, body: "Standard cohort post")

    user_broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| user_broadcasts << [ target, payload ] }

    MessageBroadcastService.created(message)

    channel_payload = user_broadcasts.find { |target, _payload| target == student }.second.fetch(:channel)
    assert_not channel_payload.key?(:can_post)
    assert_not channel_payload.key?(:post_disabled_reason)
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
  end

  test "peer-space channel broadcast queries stay flat as recipient count grows" do
    curriculum = Curriculum.create!(name: "Flat Query Self-Paced")
    instructor = User.create!(clerk_id: "flat_sp_instructor", email: "flat-sp-inst@example.com", role: :instructor)
    admin = User.create!(clerk_id: "flat_sp_admin", email: "flat-sp-admin@example.com", role: :admin)
    cohort = Cohort.create!(
      curriculum: curriculum,
      name: "Flat Query Peer Space",
      start_date: Date.current,
      status: :active,
      course_delivery: "self_paced"
    )
    cohort.cohort_instructor_assignments.create!(user: instructor)
    cohort.update!(support_instructor: instructor)
    SchoolSetting.current.update!(features: { "self_paced_peer_space" => true })
    cohort.update!(settings: { "features" => { "self_paced_peer_space" => true } })
    channel = cohort.channels.find_by!(name: "Class Chat")

    author = User.create!(clerk_id: "flat_sp_author", email: "flat-sp-author@example.com", role: :student)
    expired = User.create!(clerk_id: "flat_sp_expired", email: "flat-sp-expired@example.com", role: :student)
    Enrollment.create!(user: author, cohort: cohort, status: :active, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now)
    Enrollment.create!(user: expired, cohort: cohort, status: :active, first_opened_at: 2.months.ago, support_expires_at: 1.day.ago, access_expires_at: 2.months.from_now)

    user_broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| user_broadcasts << [ target, payload ] }

    first_message = Message.create!(channel: channel, author: author, body: "First wave")
    # Warm schema/metadata before comparing small vs larger recipient counts.
    MessageBroadcastService.created(Message.find(first_message.id))
    user_broadcasts.clear

    small_count = count_queries { MessageBroadcastService.created(Message.find(first_message.id)) }
    by_user = user_broadcasts.to_h
    assert_equal true, by_user.fetch(author).dig(:channel, :can_post)
    assert_nil by_user.fetch(author).dig(:channel, :post_disabled_reason)
    assert_equal false, by_user.fetch(expired).dig(:channel, :can_post)
    assert_match(/support period has ended/i, by_user.fetch(expired).dig(:channel, :post_disabled_reason))
    assert_equal true, by_user.fetch(instructor).dig(:channel, :can_post)
    assert_equal true, by_user.fetch(admin).dig(:channel, :can_post)

    5.times do |index|
      peer = User.create!(clerk_id: "flat_sp_peer_#{index}", email: "flat-sp-peer-#{index}@example.com", role: :student)
      Enrollment.create!(user: peer, cohort: cohort, status: :active, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now)
    end

    user_broadcasts.clear
    second_message = Message.create!(channel: channel, author: author, body: "Second wave")
    large_count = count_queries { MessageBroadcastService.created(Message.find(second_message.id)) }

    assert_equal 9, user_broadcasts.size
    assert_equal small_count, large_count, "Expected flat broadcast query count across recipient growth (small=#{small_count}, large=#{large_count})"
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
  end
end
