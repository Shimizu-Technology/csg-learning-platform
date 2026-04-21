require "test_helper"

class WebPushNotificationServiceTest < ActiveSupport::TestCase
  test "attachment only messages use fallback body text" do
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
    notification = Notification.new(user: recipient)

    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_notifications) do |_notifications, raw_payload|
      payload = JSON.parse(raw_payload)
    end

    service.message_created(message, [ notification ])

    assert_equal "Push Author: Sent an attachment", payload.fetch("body")
  end
end
