class MessageNotificationEmailJob < ApplicationJob
  queue_as :default
  retry_on NotificationEmailService::DeliveryError, wait: :polynomially_longer, attempts: 4
  discard_on NotificationEmailService::ConfigurationError, report: true do |job, error|
    Rails.logger.error(
      "[MessageEmailJob] discarded message_id=#{job.arguments.first} " \
      "reason=configuration_error error=#{error.message}"
    )
  end

  def perform(message_id, notification_ids)
    return if notification_ids.blank?

    message = Message.includes(:author, :channel, :direct_conversation, :message_attachments).find_by(id: message_id)
    return unless message
    return if message.deleted?

    notifications = Notification.includes(:user).where(id: notification_ids)
    Rails.logger.info(
      "[MessageEmailJob] started message_id=#{message.id} requested_notifications=#{notification_ids.size}"
    )

    notifications.find_each do |notification|
      user = notification.user
      if user.archived?
        Rails.logger.info("[MessageEmailJob] skipped notification_id=#{notification.id} recipient_user_id=#{user.id} reason=archived")
        next
      end
      unless user.message_email_notifications_enabled?
        Rails.logger.info("[MessageEmailJob] skipped notification_id=#{notification.id} recipient_user_id=#{user.id} reason=preference_disabled")
        next
      end
      if user.email.blank?
        Rails.logger.warn("[MessageEmailJob] skipped notification_id=#{notification.id} recipient_user_id=#{user.id} reason=email_unavailable")
        next
      end

      NotificationEmailService.send_message_notification(user: user, message: message, notification: notification)
    end
  end
end
