class MessageNotificationEmailJob < ApplicationJob
  queue_as :default

  def perform(message_id, notification_ids)
    return if notification_ids.blank?

    message = Message.includes(:author, :channel, :direct_conversation, :message_attachments).find_by(id: message_id)
    return unless message
    return if message.deleted?

    Notification.includes(:user).where(id: notification_ids).find_each do |notification|
      user = notification.user
      next if user.archived?
      next unless user.message_email_notifications_enabled?

      NotificationEmailService.send_message_notification(user: user, message: message, notification: notification)
    end
  end
end
