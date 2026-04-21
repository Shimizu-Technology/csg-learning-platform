require "test_helper"

class NotificationDeliveryServiceTest < ActiveSupport::TestCase
  test "attachment only messages get a fallback notification body" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "notify_author", email: "notify-author@example.com", first_name: "Notify", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "notify_student", email: "notify-student@example.com", first_name: "Notify", last_name: "Student", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)

    message = Message.create!(channel: channel, author: author, body: "")
    message.message_attachments.create!(
      uploaded_by: author,
      s3_key: "message_attachments/channel_#{channel.id}/sample.png",
      filename: "sample.png",
      content_type: "image/png",
      byte_size: 1024
    )

    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }

    assert_equal "Sent an attachment", notification.body
  end
end
