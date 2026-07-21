class PushNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveJob::DeserializationError

  def perform(notifiable_type, notifiable_id, notification_ids)
    notifiable = notifiable_type.safe_constantize&.find_by(id: notifiable_id)
    return unless notifiable

    notifications = Notification.where(id: notification_ids)
    case notifiable
    when Announcement
      deliver(WebPushNotificationService, :announcement_published, notifiable, notifications)
      deliver(ExpoPushNotificationService, :announcement_published, notifiable, notifications)
    when Message
      deliver(WebPushNotificationService, :message_created, notifiable, notifications)
      deliver(ExpoPushNotificationService, :message_created, notifiable, notifications)
    when Submission
      deliver(WebPushNotificationService, :submission_changed, notifiable, notifications)
      deliver(ExpoPushNotificationService, :submission_changed, notifiable, notifications)
    end
  end

  private

  def deliver(service, method, notifiable, notifications)
    service.public_send(method, notifiable, notifications)
  rescue StandardError => e
    Rails.logger.error("[PushNotificationJob] #{service.name} failed for #{notifiable.class.name} #{notifiable.id}: #{e.class} #{e.message}")
  end
end
