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
    ExpoPushNotificationService.define_singleton_method(:message_created) { |*, **| raise "Expo unavailable" }

    assert_nothing_raised do
      PushNotificationJob.perform_now("Message", message.id, [ notification.id ])
    end
    assert_equal [ [ message, [ notification.id ] ] ], web_deliveries
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
end
