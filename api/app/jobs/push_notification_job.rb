class PushNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveJob::DeserializationError

  def perform(notifiable_type, notifiable_id, notification_ids)
    notifiable = notifiable_type.safe_constantize&.find_by(id: notifiable_id)
    return unless notifiable

    notifications = Notification.where(id: notification_ids)
    case notifiable
    when Announcement
      deliver(WebPushNotificationService, :announcement_published, notifiable, notifications, notification_ids)
      deliver(ExpoPushNotificationService, :announcement_published, notifiable, notifications, notification_ids)
    when Message
      return if notifiable.deleted?

      blocked_user_ids = UserBlock.related_user_ids(notifiable.author_id, notifications.pluck(:user_id))
      notifications = notifications.where(user_id: notifiable.destination.recipients.reorder(nil).select(:id)).where.not(user_id: blocked_user_ids)
      not_started = [
        deliver_message_push(WebPushNotificationService, :web_push_attempted_notification_ids, notifiable, notifications),
        deliver_message_push(ExpoPushNotificationService, :expo_push_attempted_notification_ids, notifiable, notifications)
      ].compact
      # Both providers have been attempted. Report the requests that never
      # started so the message's notification stage is not marked delivered:
      # the sender's replay (or recovery) runs this job again, and only the
      # released notifications are claimed and sent.
      raise not_started.first if not_started.one?
      raise PushDeliveryNotStarted.new(provider: "web_push+expo", notification_ids: not_started.flat_map(&:notification_ids)) if not_started.any?
    when PrivateMeetingBookingEvent, Enrollment
      deliver(WebPushNotificationService, :system_notice, notifiable, notifications, notification_ids)
      deliver(ExpoPushNotificationService, :system_notice, notifiable, notifications, notification_ids)
    when Submission
      deliver(WebPushNotificationService, :submission_changed, notifiable, notifications, notification_ids)
      deliver(ExpoPushNotificationService, :submission_changed, notifiable, notifications, notification_ids)
    when HelpRequest
      deliver(WebPushNotificationService, :help_request_changed, notifiable, notifications, notification_ids)
      deliver(ExpoPushNotificationService, :help_request_changed, notifiable, notifications, notification_ids)
    when Intervention
      return unless notifiable.owner_valid?

      notifications = notifications.where(user_id: notifiable.owner_id)
      deliver(WebPushNotificationService, :intervention_changed, notifiable, notifications, notification_ids)
      deliver(ExpoPushNotificationService, :intervention_changed, notifiable, notifications, notification_ids)
    when ContentReport, DataDeletionRequest, CoursePurchase
      # Only people who are still admins when the push goes out.
      notifications = notifications.where(user_id: User.not_archived.admin.select(:id))
      deliver(WebPushNotificationService, :admin_alert, notifiable, notifications, notification_ids)
      deliver(ExpoPushNotificationService, :admin_alert, notifiable, notifications, notification_ids)
    end
  end

  private

  def deliver_message_push(service, attempted_attribute, message, notifications)
    requested_ids = notifications.pluck(:id)
    # This is an at-most-once provider-attempt boundary. Providers can raise
    # after partial external delivery and expose no transactional idempotency
    # key, so releasing the claim here could notify the same recipient twice.
    # The one exception is a notification whose requests the provider never
    # started (PushDeliveryNotStarted), released below.
    claimed_ids = message.with_lock do
      next [] if message.deleted?

      attempted_ids = Array(message.public_send(attempted_attribute)).map(&:to_i)
      next_ids = requested_ids - attempted_ids
      message.update_columns(attempted_attribute => (attempted_ids + next_ids).uniq) if next_ids.any?
      next_ids
    end
    return if claimed_ids.empty?

    begin
      service.message_created(message, Notification.where(id: claimed_ids))
    rescue PushDeliveryNotStarted => not_started
      # The provider's deadline passed before any request for these
      # notifications started, so nothing reached their devices. Releasing
      # the claim lets the next attempt send them; requests that started stay
      # claimed, which keeps the at-most-once boundary above.
      released_ids = not_started.notification_ids & claimed_ids
      release_message_push_claims(message, attempted_attribute, released_ids)
      return PushDeliveryNotStarted.new(provider: not_started.provider, notification_ids: released_ids) if released_ids.any?
    rescue StandardError => e
      log_provider_failure(service, message, claimed_ids, e)
    end
    nil
  end

  def release_message_push_claims(message, attempted_attribute, notification_ids)
    return if notification_ids.empty?

    message.with_lock do
      attempted_ids = Array(message.public_send(attempted_attribute)).map(&:to_i)
      message.update_columns(attempted_attribute => attempted_ids - notification_ids)
    end
    Rails.logger.warn(
      "[PushNotificationJob] provider_not_started_released attribute=#{attempted_attribute} " \
      "message_id=#{message.id} notification_ids=#{notification_ids.join(',')}"
    )
  end

  def deliver(service, method, notifiable, notifications, notification_ids)
    service.public_send(method, notifiable, notifications)
  rescue StandardError => e
    # Other notifiables have no per-provider claim to release, so requests a
    # deadline left unstarted are logged here and not retried.
    log_provider_failure(service, notifiable, notification_ids, e)
  end

  def log_provider_failure(service, notifiable, notification_ids, e)
    Rails.logger.error(
      "[PushNotificationJob] provider_attempt_failed provider=#{service.name} " \
      "notifiable_type=#{notifiable.class.name} notifiable_id=#{notifiable.id} " \
      "notification_ids=#{notification_ids.join(',')} error=#{e.class}: #{e.message}"
    )
  end
end
