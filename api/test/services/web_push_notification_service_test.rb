require "test_helper"

class WebPushNotificationServiceTest < ActiveSupport::TestCase
  test "announcement push payloads identify the author and include the details" do
    author = User.create!(clerk_id: "web_announcement_author", email: "web-announcement-author@example.com", first_name: "Maya", last_name: "Santos", role: :instructor)
    announcement = Announcement.create!(title: "Office hours moved", body: "Meet in the main classroom.", author: author, audience: :global, status: :published)
    notification = author.notifications.create!(notifiable: announcement, notification_type: :announcement, title: announcement.title, body: announcement.body, path: "/updates")
    payload = nil
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_notifications) { |_notifications, raw_payload| payload = JSON.parse(raw_payload) }

    service.announcement_published(announcement, [ notification ])

    assert_equal "Office hours moved", payload.fetch("title")
    assert_equal "Maya Santos · Meet in the main classroom.", payload.fetch("body")
  end

  test "message push payloads use notification body for array inputs" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "push_author", email: "push-author@example.com", first_name: "Push", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "push_recipient", email: "push-recipient@example.com", first_name: "Push", last_name: "Recipient", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)

    message = Message.create!(channel: channel, author: author, body: "")
    message.message_attachments.create!(
      uploaded_by: author,
      s3_key: "message_attachments/channel_#{channel.id}/sample.png",
      filename: "sample.png",
      content_type: "image/png",
      byte_size: 1024
    )

    payload = nil
    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }

    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_user) do |_user_id, raw_payload|
      payload = JSON.parse(raw_payload)
    end

    service.message_created(message, [ notification ])

    assert_equal "Sent an attachment", payload.fetch("body")
    assert_equal message.id, payload.fetch("message_id")
  end

  test "message and announcement pushes show plain text instead of Markdown (M-8)" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "md_push_author", email: "md-push-author@example.com", first_name: "Md", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "md_push_recipient", email: "md-push-recipient@example.com", first_name: "Md", last_name: "Recipient", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: channel, author: author, body: "**What `git init` does:** makes a repo.\n\n```bash\nls -a\n```")
    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }
    payloads = []
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_user) { |_user_id, raw_payload| payloads << JSON.parse(raw_payload) }
    service.define_singleton_method(:deliver_to_notifications) { |_notifications, raw_payload| payloads << JSON.parse(raw_payload) }

    service.message_created(message, [ notification ])
    announcement = Announcement.create!(title: "Setup", body: "Run **`bin/rails db:migrate`** first.", author: author, audience: :global, status: :published)
    service.announcement_published(announcement, [])

    assert_equal "What git init does: makes a repo. ls -a", payloads.first.fetch("body")
    assert_equal "Md Author · Run bin/rails db:migrate first.", payloads.last.fetch("body")
    assert_includes notification.body, "**What `git init` does:**", "the stored body keeps Markdown for in-app rendering"
  end

  test "grading feedback pushes show plain text instead of Markdown" do
    notification = Struct.new(:user_id, :title, :body, :legacy_path, :destination_path)
      .new(7, "Feedback on Loops", "**Close!** Use `for word in words:`\n\n```python\nprint(word)\n```", "/lessons/3", "/lessons/3")
    payloads = []
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_user) { |_user_id, raw_payload| payloads << JSON.parse(raw_payload) }

    service.submission_changed(Struct.new(:id).new(11), [ notification ])

    assert_equal "Close! Use for word in words: print(word)", payloads.sole.fetch("body")
    assert_equal "submission-11", payloads.sole.fetch("tag")
  end

  test "does not deliver to a user who disabled browser push" do
    user = User.create!(clerk_id: "web_push_disabled", email: "web-push-disabled@example.com", web_push_notifications_enabled: false)
    subscription = user.push_subscriptions.create!(endpoint: "https://push.example/disabled", p256dh: "public-key", auth: "auth-secret")
    deliveries = []
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver) { |item, _payload| deliveries << item.id }

    service.send(:deliver_to_user, user.id, "{}")

    assert_empty deliveries
    assert_nil subscription.reload.failed_at
  end
end
