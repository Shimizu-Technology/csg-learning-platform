require "test_helper"

class MessageNotificationEmailJobTest < ActiveJob::TestCase
  test "delivery failures escape the job so Active Job can retry them" do
    curriculum = Curriculum.create!(name: "Messaging Reliability")
    cohort = Cohort.create!(curriculum: curriculum, name: "Email Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "email_job_author", email: "author@example.com", role: :student)
    recipient = User.create!(clerk_id: "email_job_recipient", email: "recipient@example.com", role: :student)
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Important update")
    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }

    original_send = NotificationEmailService.method(:send_message_notification)
    NotificationEmailService.define_singleton_method(:send_message_notification) do |**|
      raise NotificationEmailService::DeliveryError, "provider unavailable"
    end

    error = assert_raises(NotificationEmailService::DeliveryError) do
      MessageNotificationEmailJob.new.perform(message.id, [ notification.id ])
    end
    assert_equal "provider unavailable", error.message
  ensure
    NotificationEmailService.define_singleton_method(:send_message_notification, original_send) if original_send
  end

  test "configuration failures are reported and discarded without retrying" do
    curriculum = Curriculum.create!(name: "Messaging Configuration")
    cohort = Cohort.create!(curriculum: curriculum, name: "Configuration Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "email_config_author", email: "author@example.com", role: :student)
    recipient = User.create!(clerk_id: "email_config_recipient", email: "recipient@example.com", role: :student)
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Configuration check")
    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }

    original_send = NotificationEmailService.method(:send_message_notification)
    NotificationEmailService.define_singleton_method(:send_message_notification) do |**|
      raise NotificationEmailService::ConfigurationError, "sender email is not configured"
    end

    assert_no_enqueued_jobs do
      MessageNotificationEmailJob.perform_now(message.id, [ notification.id ])
    end
  ensure
    NotificationEmailService.define_singleton_method(:send_message_notification, original_send) if original_send
  end

  test "disabled recipients are diagnosed and skipped" do
    curriculum = Curriculum.create!(name: "Messaging Preferences")
    cohort = Cohort.create!(curriculum: curriculum, name: "Preference Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "email_skip_author", email: "author@example.com", role: :student)
    recipient = User.create!(
      clerk_id: "email_skip_recipient",
      email: "recipient@example.com",
      role: :student,
      message_email_notifications_enabled: false
    )
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Preference check")
    notification = Notification.create!(
      user: recipient,
      actor: author,
      notifiable: message,
      notification_type: :direct_message,
      title: "A message",
      body: message.body,
      path: "/messages/dm/#{conversation.id}"
    )
    deliveries = 0

    original_send = NotificationEmailService.method(:send_message_notification)
    NotificationEmailService.define_singleton_method(:send_message_notification) { |**| deliveries += 1 }

    MessageNotificationEmailJob.new.perform(message.id, [ notification.id ])

    assert_equal 0, deliveries
  ensure
    NotificationEmailService.define_singleton_method(:send_message_notification, original_send) if original_send
  end
end
