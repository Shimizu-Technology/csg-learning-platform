require "test_helper"

class PushNotificationJobTest < ActiveJob::TestCase
  test "Expo delivery still runs when web push raises unexpectedly" do
    user = User.create!(clerk_id: "push_job_author", email: "push-job-author@example.com", role: :admin)
    announcement = Announcement.create!(title: "Delivery isolation", body: "Test", author: user, audience: :global, status: :published)
    notification = user.notifications.create!(notifiable: announcement, notification_type: :announcement, title: "Update", body: "Test", path: "/updates")
    expo_deliveries = []
    original_web_delivery = WebPushNotificationService.method(:announcement_published)
    original_expo_delivery = ExpoPushNotificationService.method(:announcement_published)
    WebPushNotificationService.define_singleton_method(:announcement_published) { |*, **| raise "web push unavailable" }
    ExpoPushNotificationService.define_singleton_method(:announcement_published) { |notifiable, notifications| expo_deliveries << [ notifiable, notifications.pluck(:id) ] }

    assert_nothing_raised do
      PushNotificationJob.perform_now("Announcement", announcement.id, [ notification.id ])
    end
    assert_equal [ [ announcement, [ notification.id ] ] ], expo_deliveries
  ensure
    WebPushNotificationService.define_singleton_method(:announcement_published, original_web_delivery) if defined?(original_web_delivery) && original_web_delivery
    ExpoPushNotificationService.define_singleton_method(:announcement_published, original_expo_delivery) if defined?(original_expo_delivery) && original_expo_delivery
  end

  test "web push delivery still runs when Expo raises unexpectedly" do
    user = User.create!(clerk_id: "push_job_message_author", email: "push-job-message-author@example.com", role: :admin)
    curriculum = Curriculum.create!(name: "Push Job Curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push Job Cohort", start_date: Date.current, status: :active)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: user, body: "Hello")
    notification = user.notifications.create!(notifiable: message, notification_type: :message, title: "Message", body: "Hello", path: "/messages/#{message.id}")
    web_deliveries = []
    original_web_delivery = WebPushNotificationService.method(:message_created)
    original_expo_delivery = ExpoPushNotificationService.method(:message_created)
    WebPushNotificationService.define_singleton_method(:message_created) { |notifiable, notifications| web_deliveries << [ notifiable, notifications.pluck(:id) ] }
    expo_attempts = 0
    errors = []
    original_log_error = Rails.logger.method(:error)
    Rails.logger.define_singleton_method(:error) { |entry| errors << entry }
    ExpoPushNotificationService.define_singleton_method(:message_created) do |*, **|
      expo_attempts += 1
      raise "Expo unavailable"
    end

    assert_nothing_raised do
      2.times { PushNotificationJob.perform_now("Message", message.id, [ notification.id ]) }
    end
    assert_equal [ [ message, [ notification.id ] ] ], web_deliveries
    assert_equal 1, expo_attempts, "a provider exception may follow partial external delivery and must not be retried blindly"
    assert_equal 1, errors.size
    assert_includes errors.first, "provider=ExpoPushNotificationService"
    assert_includes errors.first, "notification_ids=#{notification.id}"
  ensure
    Rails.logger.define_singleton_method(:error, original_log_error) if defined?(original_log_error) && original_log_error
    WebPushNotificationService.define_singleton_method(:message_created, original_web_delivery) if defined?(original_web_delivery) && original_web_delivery
    ExpoPushNotificationService.define_singleton_method(:message_created, original_expo_delivery) if defined?(original_expo_delivery) && original_expo_delivery
  end

  test "message push skips a recipient who blocks before the queued job runs" do
    author = User.create!(clerk_id: "push_block_author", email: "push-block-author@example.com", role: :student)
    recipient = User.create!(clerk_id: "push_block_recipient", email: "push-block-recipient@example.com", role: :student)
    curriculum = Curriculum.create!(name: "Push block curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push block cohort", start_date: Date.current, status: :active)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Must not push")
    notification = recipient.notifications.create!(actor: author, notifiable: message, notification_type: :message, title: "Message", body: message.body, path: "/messages")
    UserBlock.create!(blocker: recipient, blocked_user: author)
    deliveries = []
    original_web_delivery = WebPushNotificationService.method(:message_created)
    original_expo_delivery = ExpoPushNotificationService.method(:message_created)
    WebPushNotificationService.define_singleton_method(:message_created) { |_message, notifications| deliveries << notifications.pluck(:id) }
    ExpoPushNotificationService.define_singleton_method(:message_created) { |_message, notifications| deliveries << notifications.pluck(:id) }

    PushNotificationJob.perform_now("Message", message.id, [ notification.id ])

    assert_empty deliveries
    assert Notification.exists?(notification.id)
  ensure
    WebPushNotificationService.define_singleton_method(:message_created, original_web_delivery) if defined?(original_web_delivery) && original_web_delivery
    ExpoPushNotificationService.define_singleton_method(:message_created, original_expo_delivery) if defined?(original_expo_delivery) && original_expo_delivery
  end

  test "repeated message jobs forward each notification only once per provider" do
    author = User.create!(clerk_id: "push_dedupe_author", email: "push-dedupe-author@example.com", role: :student)
    recipient = User.create!(clerk_id: "push_dedupe_recipient", email: "push-dedupe-recipient@example.com", role: :student)
    curriculum = Curriculum.create!(name: "Push dedupe curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push dedupe cohort", start_date: Date.current, status: :active)
    message = Message.create!(channel: cohort.channels.find_by!(name: "Class Chat"), author: author, body: "Deliver push once")
    notification = recipient.notifications.create!(actor: author, notifiable: message, notification_type: :message, title: "Message", body: message.body, path: "/messages")
    web_deliveries = []
    expo_deliveries = []
    original_web_delivery = WebPushNotificationService.method(:message_created)
    original_expo_delivery = ExpoPushNotificationService.method(:message_created)
    WebPushNotificationService.define_singleton_method(:message_created) { |_message, notifications| web_deliveries.concat(notifications.pluck(:id)) }
    ExpoPushNotificationService.define_singleton_method(:message_created) { |_message, notifications| expo_deliveries.concat(notifications.pluck(:id)) }

    2.times { PushNotificationJob.perform_now("Message", message.id, [ notification.id ]) }

    assert_equal [ notification.id ], web_deliveries
    assert_equal [ notification.id ], expo_deliveries
    assert_equal [ notification.id ], message.reload.web_push_attempted_notification_ids
    assert_equal [ notification.id ], message.expo_push_attempted_notification_ids
  ensure
    WebPushNotificationService.define_singleton_method(:message_created, original_web_delivery) if defined?(original_web_delivery) && original_web_delivery
    ExpoPushNotificationService.define_singleton_method(:message_created, original_expo_delivery) if defined?(original_expo_delivery) && original_expo_delivery
  end

  test "submission events fan out to isolated web and Expo delivery" do
    student = User.create!(clerk_id: "push_job_submission_student", email: "push-job-submission-student@example.com", role: :student)
    staff = User.create!(clerk_id: "push_job_submission_staff", email: "push-job-submission-staff@example.com", role: :instructor)
    curriculum = Curriculum.create!(name: "Push submission curriculum")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Push module", position: 0, day_offset: 0, schedule_days: "weekdays")
    lesson = Lesson.create!(curriculum_module: mod, title: "Push lesson", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Push exercise")
    submission = Submission.create!(user: student, content_block: block, text: "Ready")
    notification = staff.notifications.create!(notifiable: submission, notification_type: :submission, title: "New submission", body: "Ready", path: "/admin/grading")
    web_deliveries = []
    expo_deliveries = []
    original_web_delivery = WebPushNotificationService.method(:submission_changed)
    original_expo_delivery = ExpoPushNotificationService.method(:submission_changed)
    WebPushNotificationService.define_singleton_method(:submission_changed) { |item, notifications| web_deliveries << [ item, notifications.pluck(:id) ] }
    ExpoPushNotificationService.define_singleton_method(:submission_changed) { |item, notifications| expo_deliveries << [ item, notifications.pluck(:id) ] }

    PushNotificationJob.perform_now("Submission", submission.id, [ notification.id ])

    assert_equal [ [ submission, [ notification.id ] ] ], web_deliveries
    assert_equal [ [ submission, [ notification.id ] ] ], expo_deliveries
  ensure
    WebPushNotificationService.define_singleton_method(:submission_changed, original_web_delivery) if defined?(original_web_delivery) && original_web_delivery
    ExpoPushNotificationService.define_singleton_method(:submission_changed, original_expo_delivery) if defined?(original_expo_delivery) && original_expo_delivery
  end

  test "help request events fan out to web and Expo delivery" do
    student = User.create!(clerk_id: "push_job_help_student", email: "push-job-help-student@example.com", role: :student)
    staff = User.create!(clerk_id: "push_job_help_staff", email: "push-job-help-staff@example.com", role: :instructor)
    curriculum = Curriculum.create!(name: "Push help curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push help cohort", start_date: Date.current, status: :active)
    Enrollment.create!(user: student, cohort: cohort, status: :active)
    help_request = HelpRequest.create!(student: student, cohort: cohort, context_type: :lesson, context_source: :primary, context_id: 1, context_label: "Routes", context_path: "/lessons/1", category: :concept, urgency: :normal, message: "How do these pieces connect?")
    notification = staff.notifications.create!(notifiable: help_request, notification_type: :help_request, title: "Student asked for help", body: "Routes", path: "/admin/support")
    web_deliveries = []
    expo_deliveries = []
    original_web_delivery = WebPushNotificationService.method(:help_request_changed)
    original_expo_delivery = ExpoPushNotificationService.method(:help_request_changed)
    WebPushNotificationService.define_singleton_method(:help_request_changed) { |item, notifications| web_deliveries << [ item, notifications.pluck(:id) ] }
    ExpoPushNotificationService.define_singleton_method(:help_request_changed) { |item, notifications| expo_deliveries << [ item, notifications.pluck(:id) ] }

    PushNotificationJob.perform_now("HelpRequest", help_request.id, [ notification.id ])

    assert_equal [ [ help_request, [ notification.id ] ] ], web_deliveries
    assert_equal [ [ help_request, [ notification.id ] ] ], expo_deliveries
  ensure
    WebPushNotificationService.define_singleton_method(:help_request_changed, original_web_delivery) if defined?(original_web_delivery) && original_web_delivery
    ExpoPushNotificationService.define_singleton_method(:help_request_changed, original_expo_delivery) if defined?(original_expo_delivery) && original_expo_delivery
  end
end
