class PushNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveJob::DeserializationError

  def perform(notifiable_type, notifiable_id, notification_ids)
    notifiable = notifiable_type.safe_constantize&.find_by(id: notifiable_id)
    return unless notifiable

    notifications = Notification.where(id: notification_ids)
    case notifiable
    when Announcement
      WebPushNotificationService.announcement_published(notifiable, notifications)
    when Message
      WebPushNotificationService.message_created(notifiable, notifications)
    end
  end
end
