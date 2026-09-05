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

    assert_enqueued_with(job: MessageMentionEmailJob, args: [ message.id, [ recipient.id ], [] ]) do
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

  test "mention emails honor the global message notification preference" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "mention_pref_author", email: "mention-pref-author@example.com", role: :admin)
    enabled = User.create!(clerk_id: "mention_pref_enabled", email: "mention-pref-enabled@example.com", role: :student)
    disabled = User.create!(clerk_id: "mention_pref_disabled", email: "mention-pref-disabled@example.com", role: :student, message_email_notifications_enabled: false)
    message = Message.create!(channel: channel, author: author, body: "Please review", mention_user_ids: [ enabled.id, disabled.id ])
    deliveries = []

    original_send = NotificationEmailService.method(:send_message_mention)
    NotificationEmailService.define_singleton_method(:send_message_mention) do |user:, message:|
      deliveries << [ user.id, message.id ]
      true
    end

    MessageMentionEmailJob.perform_now(message.id, [ enabled.id, disabled.id ])

    assert_equal [ [ enabled.id, message.id ] ], deliveries
  ensure
    NotificationEmailService.define_singleton_method(:send_message_mention, original_send) if original_send
  end

  test "mention email skips a user who blocks before the queued job runs" do
    curriculum = Curriculum.create!(name: "Blocked mentions")
    cohort = Cohort.create!(curriculum: curriculum, name: "Blocked mention cohort", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "blocked_mention_author", email: "blocked-mention-author@example.com", role: :student)
    recipient = User.create!(clerk_id: "blocked_mention_recipient", email: "blocked-mention-recipient@example.com", role: :student)
    message = Message.create!(channel: channel, author: author, body: "Must not email", mention_user_ids: [ recipient.id ])
    UserBlock.create!(blocker: author, blocked_user: recipient)
    deliveries = []
    original_send = NotificationEmailService.method(:send_message_mention)
    NotificationEmailService.define_singleton_method(:send_message_mention) { |**arguments| deliveries << arguments }

    MessageMentionEmailJob.perform_now(message.id, [ recipient.id ])

    assert_empty deliveries
  ensure
    NotificationEmailService.define_singleton_method(:send_message_mention, original_send) if defined?(original_send) && original_send
  end

  test "direct message mentions stay on the generic DM email path" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "dm_mention_author", email: "dm-mention-author@example.com", role: :student)
    recipient = User.create!(clerk_id: "dm_mention_recipient", email: "dm-mention-recipient@example.com", role: :student)
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Please review", mention_user_ids: [ recipient.id ])

    assert_enqueued_with(job: MessageMentionEmailJob, args: [ message.id, [ recipient.id ], [ recipient.id ] ]) do
      NotificationDeliveryService.message_created(message)
    end
  end

  test "message notification emails mirror enabled message notifications" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "email_author", email: "email-author@example.com", first_name: "Email", last_name: "Author", role: :student)
    recipient = User.create!(clerk_id: "email_student", email: "email-student@example.com", first_name: "Email", last_name: "Student", role: :student, message_email_notifications_enabled: true)
    disabled_recipient = User.create!(clerk_id: "email_disabled", email: "email-disabled@example.com", first_name: "Disabled", last_name: "Student", role: :student, message_email_notifications_enabled: false)
    Enrollment.create!(user: author, cohort: cohort, status: :active)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    Enrollment.create!(user: disabled_recipient, cohort: cohort, status: :active)
    conversation = DirectConversation.find_or_create_for!(workspace: cohort.workspace, users: [ author, recipient, disabled_recipient ])
    message = Message.create!(direct_conversation: conversation, author: author, body: "Can everyone see this DM?")
    deliveries = []

    original_send = NotificationEmailService.method(:send_message_notification)
    NotificationEmailService.define_singleton_method(:send_message_notification) do |user:, message:, notification:|
      deliveries << [ user.id, message.id, notification.id ]
      true
    end

    perform_enqueued_jobs(only: MessageNotificationEmailJob) do
      NotificationDeliveryService.message_created(message, push: false)
    end

    assert_equal [ [ recipient.id, message.id, Notification.find_by!(notifiable: message, user: recipient).id ] ], deliveries
  ensure
    NotificationEmailService.define_singleton_method(:send_message_notification, original_send) if original_send
  end

  test "ordinary channel messages do not enqueue generic email notifications" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "channel_email_author", email: "channel-email-author@example.com", role: :admin)
    recipient = User.create!(clerk_id: "channel_email_recipient", email: "channel-email-recipient@example.com", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: channel, author: author, body: "Routine channel update")

    assert_no_enqueued_jobs(only: MessageNotificationEmailJob) do
      NotificationDeliveryService.message_created(message, push: true)
    end
  end

  test "message delivery retries enqueue each recipient push only once" do
    curriculum = Curriculum.create!(name: "Push enqueue dedupe")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push enqueue dedupe cohort", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "push_enqueue_author", email: "push-enqueue-author@example.com", role: :admin)
    recipient = User.create!(clerk_id: "push_enqueue_recipient", email: "push-enqueue-recipient@example.com", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: channel, author: author, body: "One push")

    2.times { NotificationDeliveryService.message_created(message, push: true) }

    push_jobs = enqueued_jobs.select { |job| job[:job] == PushNotificationJob }
    assert_equal 1, push_jobs.size
    notification = Notification.find_by!(notifiable: message, user: recipient)
    assert_equal [ notification.id ], message.reload.push_enqueued_notification_ids
    assert_equal [ notification.id ], push_jobs.first.fetch(:args).last
  end

  test "push enqueue cleanup cannot mask the original enqueue error" do
    curriculum = Curriculum.create!(name: "Push cleanup safety")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push cleanup cohort", start_date: Date.current, status: :active)
    author = User.create!(clerk_id: "push_cleanup_author", email: "push-cleanup-author@example.com", role: :admin)
    recipient = User.create!(clerk_id: "push_cleanup_recipient", email: "push-cleanup-recipient@example.com", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Preserve enqueue failure")
    original_enqueue = PushNotificationJob.method(:perform_later)
    PushNotificationJob.define_singleton_method(:perform_later) { |*| raise "original enqueue failure" }
    original_lock = message.method(:with_lock)
    lock_calls = 0
    message.define_singleton_method(:with_lock) do |&block|
      lock_calls += 1
      raise "cleanup lock failure" if lock_calls == 2

      original_lock.call(&block)
    end

    error = assert_raises(RuntimeError) { NotificationDeliveryService.message_created(message, push: true) }

    assert_equal "original enqueue failure", error.message
  ensure
    PushNotificationJob.define_singleton_method(:perform_later, original_enqueue) if defined?(original_enqueue) && original_enqueue
  end
end
