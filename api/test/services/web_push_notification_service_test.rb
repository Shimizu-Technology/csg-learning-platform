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
