require "test_helper"

class NotificationDeliveryServiceTest < ActiveSupport::TestCase
  include ActiveJob::TestHelper

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

  test "explicit mention ids drive mention notifications and email jobs" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "mention_author", email: "mention-author@example.com", first_name: "Notify", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "mention_student", email: "mention-student@example.com", first_name: "Same", last_name: "Name", role: :student)
    duplicate_name = User.create!(clerk_id: "mention_duplicate", email: "mention-duplicate@example.com", first_name: "Same", last_name: "Name", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    Enrollment.create!(user: duplicate_name, cohort: cohort, status: :active)

    message = Message.create!(
      channel: channel,
      author: author,
      body: "@Same Name please review this.",
      mention_user_ids: [ recipient.id ]
    )

    assert_enqueued_with(job: MessageMentionEmailJob, args: [ message.id, [ recipient.id ] ]) do
      NotificationDeliveryService.message_created(message)
    end

    recipient_notification = Notification.find_by!(notifiable: message, user: recipient)
    duplicate_notification = Notification.find_by!(notifiable: message, user: duplicate_name)

    assert_match "mentioned you", recipient_notification.title
    refute_match "mentioned you", duplicate_notification.title
  end

  test "everyone mention notifies channel recipients" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "everyone_author", email: "everyone-author@example.com", first_name: "Notify", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "everyone_student", email: "everyone-student@example.com", first_name: "Notify", last_name: "Student", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)

    message = Message.create!(channel: channel, author: author, body: "@everyone please check the schedule.")

    NotificationDeliveryService.message_created(message)

    notification = Notification.find_by!(notifiable: message, user: recipient)
    assert_match "@everyone message", notification.title
    assert_match "@everyone:", notification.body
  end
end
