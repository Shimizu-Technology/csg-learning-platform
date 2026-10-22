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
    assert_includes request.dig(:params, :html), "?message_id=#{message.id}"
    assert_equal recipient.email, request.dig(:params, :to)
    assert_equal "message-mention/#{message.id}/#{recipient.id}", request.dig(:options, :idempotency_key)
    assert_csg_learn_footer request.dig(:params, :html), "CSG Learn &middot; Code School of Guam"
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
    assert_includes request.dig(:params, :html), "?message_id=#{message.id}"
    assert_equal recipient.email, request.dig(:params, :to)
    assert_equal "message-notification/#{notification.id}", request.dig(:options, :idempotency_key)
    assert_csg_learn_footer request.dig(:params, :html), "message notifications are enabled in CSG Learn."
  ensure
    Resend::Emails.define_singleton_method(:send, original_send) if original_send
    ENV["RESEND_API_KEY"] = original_key
    ENV["RESEND_FROM_EMAIL"] = original_from
  end

  test "reply email anchors are delivery-only and preserve the stored clearing path" do
    curriculum = Curriculum.create!(name: "Reply email")
    cohort = Cohort.create!(curriculum: curriculum, name: "Reply", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "reply_email", email: "reply-email@example.com", role: :admin)
    channel = cohort.channels.find_by!(name: "Class Chat")
    root = Message.create!(channel: channel, author: author, body: "Root")
    reply = Message.create!(channel: channel, author: author, body: "Reply", parent_message: root)
    notification = Notification.create!(user: author, notifiable: reply, notification_type: :message, title: "Mention", path: "/messages/#{channel.id}")
    html = NotificationEmailService.send(:message_notification_html, user: author, message: reply, notification: notification)
    mention = NotificationEmailService.send(:mention_html, user: author, message: reply)
    [ html, mention ].each { |body| assert_includes body, "/messages/#{channel.id}?message_id=#{reply.id}" }
    assert_equal "/messages/#{channel.id}", notification.reload.path
  end

  # Daily-unlock and redo emails are rendered directly: their delivery paths are
  # exercised elsewhere and need lesson/submission graphs that add nothing here.
  test "daily unlock and redo emails use the CSG Learn footer and escape cohort names" do
    user = Struct.new(:first_name, :email).new("Maria", "maria@example.com")
    cohort = Struct.new(:name, :id).new("Pilot <Dec>", 7)
    lesson = Struct.new(:title, :id).new("Lesson 1", 1)

    unlock = NotificationEmailService.send(:daily_unlock_html, user: user, cohort: cohort, lesson_list: "<li>Lesson 1</li>", count: 1)
    assert_csg_learn_footer unlock, "CSG Learn &middot; Code School of Guam &mdash; Pilot &lt;Dec&gt;"
    refute_includes unlock, "Pilot <Dec>"
    assert_includes unlock, "/materials?cohort_id=7"

    redo_email = NotificationEmailService.send(:redo_html, user: user, lesson: lesson, exercise_title: "Exercise 1", feedback: "Check the boundary", destination: "/lessons/1?cohort_id=7#block-9")
    assert_includes redo_email, "/lessons/1?cohort_id=7#block-9"
    assert_csg_learn_footer redo_email, "CSG Learn &middot; Code School of Guam"
  end

  private

  def assert_csg_learn_footer(html, footer)
    assert_includes html, footer
    assert_includes html, "#9c292b"
    refute_match(/#2563eb|#e84545|linear-gradient|CSG Connect|CSG Learning/, html)
  end
end
