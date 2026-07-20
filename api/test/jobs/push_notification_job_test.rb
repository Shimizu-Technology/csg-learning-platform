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
end
