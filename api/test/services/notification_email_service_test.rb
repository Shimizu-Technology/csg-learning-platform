require "test_helper"

class NotificationEmailServiceTest < ActiveSupport::TestCase
  test "mention delivery uses a stable provider idempotency key" do
    curriculum = Curriculum.create!(name: "Reliable Mention Email")
    cohort = Cohort.create!(curriculum: curriculum, name: "Mention Provider Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "mention_provider_author", email: "mention-author@example.com", first_name: "Mention", last_name: "Author", role: :student)
    recipient = User.create!(clerk_id: "mention_provider_recipient", email: "mention-recipient@example.com", first_name: "Mention", last_name: "Recipient", role: :student)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "@Mention Recipient hello")
    request = nil
    original_key = ENV["RESEND_API_KEY"]
    original_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@codeschoolofguam.com>"
    original_send = Resend::Emails.method(:send)
    Resend::Emails.define_singleton_method(:send) do |params, options: {}|
      request = { params: params, options: options }
      { id: "mention-provider-message-id" }
    end

    assert NotificationEmailService.send_message_mention(user: recipient, message: message)
    assert_equal recipient.email, request.dig(:params, :to)
    assert_equal "message-mention/#{message.id}/#{recipient.id}", request.dig(:options, :idempotency_key)
  ensure
    Resend::Emails.define_singleton_method(:send, original_send) if defined?(original_send) && original_send
    ENV["RESEND_API_KEY"] = original_key
    ENV["RESEND_FROM_EMAIL"] = original_from
  end

  test "direct message delivery is idempotent and returns a verified provider id" do
    curriculum = Curriculum.create!(name: "Reliable Email")
    cohort = Cohort.create!(curriculum: curriculum, name: "Provider Cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "provider_author", email: "author@example.com", first_name: "Email", last_name: "Author", role: :student)
    recipient = User.create!(clerk_id: "provider_recipient", email: "recipient@example.com", first_name: "Email", last_name: "Recipient", role: :student)
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Provider check")
    notification = Notification.create!(
      user: recipient,
      actor: author,
      notifiable: message,
      notification_type: :direct_message,
      title: "Email Author sent you a message",
      body: message.body,
      path: "/messages/dm/#{conversation.id}"
    )
    request = nil
    original_key = ENV["RESEND_API_KEY"]
    original_from = ENV["RESEND_FROM_EMAIL"]
    ENV["RESEND_API_KEY"] = "re_test"
    ENV["RESEND_FROM_EMAIL"] = "CSG <notifications@codeschoolofguam.com>"

    original_send = Resend::Emails.method(:send)
    Resend::Emails.define_singleton_method(:send) do |params, options: {}|
      request = { params: params, options: options }
      { id: "provider-message-id" }
    end

    delivered = NotificationEmailService.send_message_notification(
      user: recipient,
      message: message,
      notification: notification
    )

    assert delivered
    assert_equal recipient.email, request.dig(:params, :to)
    assert_equal "message-notification/#{notification.id}", request.dig(:options, :idempotency_key)
  ensure
    Resend::Emails.define_singleton_method(:send, original_send) if original_send
    ENV["RESEND_API_KEY"] = original_key
    ENV["RESEND_FROM_EMAIL"] = original_from
  end
end
