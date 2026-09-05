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
      blocked_user_ids = UserBlock.related_user_ids(notifiable.author_id, notifications.pluck(:user_id))
      notifications = notifications.where.not(user_id: blocked_user_ids)
      deliver_message_push(WebPushNotificationService, :web_push_attempted_notification_ids, notifiable, notifications)
      deliver_message_push(ExpoPushNotificationService, :expo_push_attempted_notification_ids, notifiable, notifications)
    when Submission
      deliver(WebPushNotificationService, :submission_changed, notifiable, notifications)
      deliver(ExpoPushNotificationService, :submission_changed, notifiable, notifications)
    when HelpRequest
      deliver(WebPushNotificationService, :help_request_changed, notifiable, notifications)
      deliver(ExpoPushNotificationService, :help_request_changed, notifiable, notifications)
    when Intervention
      deliver(WebPushNotificationService, :intervention_changed, notifiable, notifications)
      deliver(ExpoPushNotificationService, :intervention_changed, notifiable, notifications)
    end
  end

  private

  def deliver_message_push(service, attempted_attribute, message, notifications)
    requested_ids = notifications.pluck(:id)
    claimed_ids = message.with_lock do
      attempted_ids = Array(message.public_send(attempted_attribute)).map(&:to_i)
      next_ids = requested_ids - attempted_ids
      message.update_columns(attempted_attribute => (attempted_ids + next_ids).uniq) if next_ids.any?
      next_ids
    end
    return if claimed_ids.empty?

    deliver(service, :message_created, message, Notification.where(id: claimed_ids))
  end

  def deliver(service, method, notifiable, notifications)
    service.public_send(method, notifiable, notifications)
  rescue StandardError => e
    Rails.logger.error("[PushNotificationJob] #{service.name} failed for #{notifiable.class.name} #{notifiable.id}: #{e.class} #{e.message}")
  end
end
