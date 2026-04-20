class PushNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveJob::DeserializationError

  def perform(announcement_id, notification_ids)
    announcement = Announcement.find_by(id: announcement_id)
    return unless announcement

    notifications = Notification.where(id: notification_ids)
    WebPushNotificationService.announcement_published(announcement, notifications)
  end
end
