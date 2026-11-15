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
    blocked_user_ids = UserBlock.related_user_ids(message.author_id, notifications.pluck(:user_id))
    notifications = notifications.where(user_id: message.destination.recipients.reorder(nil).select(:id)).where.not(user_id: blocked_user_ids)
    Rails.logger.info(
      "[MessageEmailJob] started message_id=#{message.id} requested_notifications=#{notification_ids.size}"
    )

    first_failure = nil
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

      begin
        NotificationEmailService.send_message_notification(user: user, message: message, notification: notification)
      rescue NotificationEmailService::ConfigurationError
        raise
      rescue NotificationEmailService::DeliveryError => error
        # One recipient's failure must not skip the others. A retry resends
        # only what Resend has not accepted: every email carries an
        # idempotency key per notification.
        first_failure ||= error
      end
    end
    raise first_failure if first_failure
  end

  # Production runs jobs inline, inside the message delivery flow (#216),
  # where a retry cannot be scheduled: the inline adapter raises
  # NotImplementedError, a ScriptError that used to escape the flow's
  # `rescue StandardError` and turn a saved DM into a 500. The send was
  # attempted before the notification stage is marked delivered, as on a
  # queue backend's first attempt, so the failure is logged and reported and
  # the delivery continues. Retrying it needs a job runner (AS-6, W9.1).
  def retry_job(options = {})
    super
  rescue NotImplementedError
    error = options[:error]
    Rails.logger.error(
      "[MessageEmailJob] retry_unavailable message_id=#{arguments.first} adapter=#{self.class.queue_adapter_name} " \
      "error=#{error&.class}: #{error&.message}"
    )
    Rails.error.report(error, handled: true, source: "message_notification_email_job", context: { message_id: arguments.first }) if error
  end
end
