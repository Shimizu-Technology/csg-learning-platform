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

    assert_raises(RuntimeError) { MessageDeliveryService.created(message) }
    assert_includes message.reload.delivered_recipient_ids(:broadcast_recipient_ids), author.id
    assert_not_includes message.delivered_recipient_ids(:broadcast_recipient_ids), recipient.id

    fail_recipient = false
    MessageDeliveryService.created(message)
    MessageDeliveryService.created(message)

    assert_equal 1, attempts[author.id]
    assert_equal 2, attempts[recipient.id]
    assert_equal 1, notification_attempts
    assert_equal [ author.id, recipient.id ].sort, message.reload.delivered_recipient_ids(:broadcast_recipient_ids).sort
    assert message.notifications_delivered_at?
    assert message.broadcasts_delivered_at?
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
    NotificationDeliveryService.define_singleton_method(:message_created, original_notifications) if defined?(original_notifications) && original_notifications
  end
end
