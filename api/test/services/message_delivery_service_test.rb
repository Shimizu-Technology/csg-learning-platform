require "test_helper"

class MessageDeliveryServiceTest < ActiveSupport::TestCase
  test "retries only unfinished recipient broadcasts" do
    curriculum = Curriculum.create!(name: "Delivery curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Delivery cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "delivery_author", email: "delivery-author@example.com", first_name: "Delivery", last_name: "Author", role: :student)
    recipient = User.create!(clerk_id: "delivery_recipient", email: "delivery-recipient@example.com", first_name: "Delivery", last_name: "Recipient", role: :student)
    Enrollment.create!(user: author, cohort: cohort, status: :active)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Deliver once")

    original_notifications = NotificationDeliveryService.method(:message_created)
    notification_attempts = 0
    NotificationDeliveryService.define_singleton_method(:message_created) do |_message, push: false|
      notification_attempts += 1
      []
    end
    original_broadcast = UserMessagesChannel.method(:broadcast_to)
    attempts = Hash.new(0)
    fail_recipient = true
    UserMessagesChannel.define_singleton_method(:broadcast_to) do |user, _payload|
      attempts[user.id] += 1
      raise "recipient unavailable" if user.id == recipient.id && fail_recipient
    end

    delivery_error = assert_raises(MessageBroadcastService::BroadcastFailures) { MessageDeliveryService.created(message) }
    assert_instance_of RuntimeError, delivery_error.cause
    assert_includes message.reload.delivered_recipient_ids(:broadcast_recipient_ids), author.id
    assert_not_includes message.delivered_recipient_ids(:broadcast_recipient_ids), recipient.id

    fail_recipient = false
    MessageDeliveryService.created(message)
    MessageDeliveryService.created(message)

    assert_equal 1, attempts[author.id]
    assert_equal 2, attempts[recipient.id]
    assert_equal 1, notification_attempts
    assert_empty message.reload.delivered_recipient_ids(:broadcast_recipient_ids)
    assert message.notifications_delivered_at?
    assert message.broadcasts_delivered_at?
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
    NotificationDeliveryService.define_singleton_method(:message_created, original_notifications) if defined?(original_notifications) && original_notifications
  end

  test "expired claimants cannot complete or release a newer delivery lease" do
    curriculum = Curriculum.create!(name: "Delivery lease curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Delivery lease cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "delivery_lease_author", email: "delivery-lease-author@example.com", first_name: "Lease", last_name: "Author", role: :admin)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Lease ownership")
    message.update_columns(broadcast_delivery_started_at: 6.minutes.ago, broadcast_delivery_claim: "expired-claim")

    fresh_claim = MessageDeliveryService.send(
      :claim_delivery,
      message,
      :broadcasts_delivered_at,
      :broadcast_delivery_started_at,
      :broadcast_delivery_claim
    )

    assert_match(/\A[0-9a-f-]{36}\z/, fresh_claim)
    assert_not MessageDeliveryService.send(
      :complete_delivery,
      message,
      :broadcasts_delivered_at,
      :broadcast_delivery_started_at,
      :broadcast_delivery_claim,
      "expired-claim",
      :broadcast_recipient_ids
    )
    assert_nil message.reload.broadcasts_delivered_at
    assert_not MessageDeliveryService.send(
      :release_delivery,
      message,
      :broadcast_delivery_started_at,
      :broadcast_delivery_claim,
      "expired-claim"
    )
    assert_not MessageDeliveryService.send(
      :checkpoint_recipients,
      message,
      :broadcast_recipient_ids,
      :broadcast_delivery_started_at,
      :broadcast_delivery_claim,
      "expired-claim",
      [ author.id ]
    )
    assert_empty message.reload.delivered_recipient_ids(:broadcast_recipient_ids)
    assert_equal fresh_claim, message.reload.broadcast_delivery_claim
    assert MessageDeliveryService.send(
      :release_delivery,
      message,
      :broadcast_delivery_started_at,
      :broadcast_delivery_claim,
      fresh_claim
    )
  end

  test "cleanup failures preserve the delivery error and still release the lease" do
    curriculum = Curriculum.create!(name: "Delivery cleanup curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Delivery cleanup cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "delivery_cleanup_author", email: "delivery-cleanup-author@example.com", first_name: "Cleanup", last_name: "Author", role: :admin)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Preserve the failure")

    original_broadcast = MessageBroadcastService.method(:created)
    MessageBroadcastService.define_singleton_method(:created) do |_message, **_options, &block|
      block.call(author)
      raise "original delivery failure"
    end
    original_checkpoint = MessageDeliveryService.method(:checkpoint_recipients)
    MessageDeliveryService.define_singleton_method(:checkpoint_recipients) { |*_args| raise "cleanup checkpoint failure" }

    error = assert_raises(RuntimeError) do
      MessageDeliveryService.send(:deliver_message_broadcast, message)
    end

    assert_equal "original delivery failure", error.message
    assert_nil message.reload.broadcast_delivery_claim
    assert_nil message.broadcast_delivery_started_at
  ensure
    MessageBroadcastService.define_singleton_method(:created, original_broadcast) if defined?(original_broadcast) && original_broadcast
    if defined?(original_checkpoint) && original_checkpoint
      MessageDeliveryService.define_singleton_method(:checkpoint_recipients, original_checkpoint)
      MessageDeliveryService.singleton_class.send(:private, :checkpoint_recipients)
    end
  end

  test "a missing thread parent completes the thread stage without retrying forever" do
    curriculum = Curriculum.create!(name: "Missing parent curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Missing parent cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "missing_parent_author", email: "missing-parent@example.com", role: :admin)
    channel = cohort.channels.find_by!(name: "Class Chat")
    root = Message.create!(channel: channel, author: author, body: "Removed root")
    reply = Message.create!(channel: channel, author: author, parent_message: root, body: "Orphaned reply")

    original_find_by = Message.method(:find_by)
    begin
      Message.define_singleton_method(:find_by) do |*arguments|
        query = arguments.first
        query.is_a?(Hash) && query[:id] == root.id ? nil : original_find_by.call(*arguments)
      end
      assert MessageDeliveryService.send(:deliver_thread_broadcast, reply)
    ensure
      Message.define_singleton_method(:find_by, original_find_by)
    end

    reply.reload
    assert reply.thread_broadcasts_delivered_at?
    assert_nil reply.thread_broadcast_delivery_claim
    assert_empty reply.delivered_recipient_ids(:thread_broadcast_recipient_ids)
  end
end
