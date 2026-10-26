require "test_helper"

class MessageNotificationEmailJobTest < ActiveJob::TestCase
  setup do
    @original_provenance_enabled = ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"]
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = "true"
  end

  teardown do
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = @original_provenance_enabled
  end
  test "delivery failures escape the job so Active Job can retry them" do
    curriculum = Curriculum.create!(name: "Messaging Reliability")
    cohort = Cohort.create!(curriculum: curriculum, name: "Email Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "email_job_author", email: "author@example.com", role: :student)
    recipient = User.create!(clerk_id: "email_job_recipient", email: "recipient@example.com", role: :student)
    [ author, recipient ].each { |user| Enrollment.create!(user: user, cohort: cohort, status: :active) }
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
    [ author, recipient ].each { |user| Enrollment.create!(user: user, cohort: cohort, status: :active) }
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
    [ author, recipient ].each { |user| Enrollment.create!(user: user, cohort: cohort, status: :active) }
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

  test "recipient blocking before the queued job runs suppresses message email" do
    curriculum = Curriculum.create!(name: "Blocked Messaging")
    cohort = Cohort.create!(curriculum: curriculum, name: "Blocked Email Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "blocked_email_author", email: "blocked-email-author@example.com", role: :student)
    recipient = User.create!(clerk_id: "blocked_email_recipient", email: "blocked-email-recipient@example.com", role: :student)
    [ author, recipient ].each { |user| Enrollment.create!(user: user, cohort: cohort, status: :active) }
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Must not email")
    notification = recipient.notifications.create!(actor: author, notifiable: message, notification_type: :direct_message, title: "Message", body: message.body, path: "/messages")
    UserBlock.create!(blocker: recipient, blocked_user: author)
    deliveries = 0
    original_send = NotificationEmailService.method(:send_message_notification)
    NotificationEmailService.define_singleton_method(:send_message_notification) { |**| deliveries += 1 }

    MessageNotificationEmailJob.perform_now(message.id, [ notification.id ])

    assert_equal 0, deliveries
  ensure
    NotificationEmailService.define_singleton_method(:send_message_notification, original_send) if defined?(original_send) && original_send
  end
  test "a legacy recipient replay does not block later tagged recipients" do
    curriculum = Curriculum.create!(name: "Mixed provenance")
    cohort = Cohort.create!(curriculum: curriculum, name: "Mixed provenance", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "mixed_author", email: "mixed-author@example.com", role: :student)
    recipients = 2.times.map do |index|
      User.create!(clerk_id: "mixed_recipient_#{index}", email: "mixed-#{index}@example.com", role: :student)
    end
    [ author, *recipients ].each { |user| Enrollment.create!(user: user, cohort: cohort, status: :active) }
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Mixed provenance")
    notifications = recipients.map do |recipient|
      Notification.create!(user: recipient, actor: author, notifiable: message, notification_type: :message,
        title: "Mixed provenance", path: "/messages/#{message.channel_id}")
    end
    legacy, current = notifications
    Notification.connection.execute("UPDATE notifications SET email_application = NULL WHERE id = #{legacy.id}")
    legacy.reload
    assert_equal "csg_learn", message.email_application
    assert_equal "csg_learn", current.email_application
    assert_raises(ActiveRecord::ReadonlyAttributeError) { message.email_application = nil }
    assert_raises(ActiveRecord::ReadonlyAttributeError) { current.email_application = nil }

    # Both phase-two producers and phase-one readers must honor persisted tags.
    ENV["EMAIL_APPLICATION_PROVENANCE_ENABLED"] = "false"
    original_key = ENV["RESEND_API_KEY"]
    original_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@codeschoolofguam.com>"
    original_send = Resend::Emails.method(:send)
    accepted = {}
    calls = []
    Resend::Emails.define_singleton_method(:send) do |params, options: {}|
      key = options.fetch(:idempotency_key)
      raise "invalid_idempotent_request" if accepted.key?(key) && accepted[key] != params
      accepted[key] = params.deep_dup
      calls << key
      { id: "mixed-provider-id" }
    end
    assert NotificationEmailService.send_message_notification(user: recipients.first, message: message, notification: legacy)
    legacy_key = "message-notification/#{legacy.id}"
    # The provider accepted this original untagged body before the rollout.
    accepted[legacy_key] = accepted.fetch(legacy_key).except(:tags)
    2.times { MessageNotificationEmailJob.new.perform(message.id, notifications.map(&:id)) }

    current_key = "message-notification/#{current.id}"
    assert_equal [ legacy_key, legacy_key, current_key, legacy_key, current_key ], calls
    refute accepted.fetch(legacy_key).key?(:tags)
    assert_equal [ { name: "application", value: "csg_learn" } ], accepted.fetch(current_key)[:tags]
  ensure
    Resend::Emails.define_singleton_method(:send, original_send) if original_send
    ENV["RESEND_API_KEY"] = original_key
    ENV["RESEND_FROM_EMAIL"] = original_from
  end
end
