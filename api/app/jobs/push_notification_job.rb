class PushNotificationJob < ApplicationJob
  queue_as :default

  discard_on ActiveJob::DeserializationError

  attr_writer :clock

  def perform(notifiable_type, notifiable_id, notification_ids)
    notifiable = notifiable_type.safe_constantize&.find_by(id: notifiable_id)
    return unless notifiable

    notifications = Notification.where(id: notification_ids)
    case notifiable
    when Announcement
      unless notifiable.published?
        notifiable.with_lock do
          notifiable.update_columns(push_settled_at: Time.current) unless notifiable.published?
        end
        return
      end
      return if notifiable.fanout_requested_at && !notifiable.fanout_settled_at
      # The push outbox (ScheduledAnnouncementPublisher): each recipient is
      # claimed per provider under the update's row lock before it is sent,
      # so a re-request after a crash, a retry, or two jobs at once push each
      # recipient at most once per provider.
      not_started = [
        deliver_claimed_push(WebPushNotificationService, :announcement_published, :web_push_attempted_notification_ids, notifiable, notifications),
        deliver_claimed_push(ExpoPushNotificationService, :announcement_published, :expo_push_attempted_notification_ids, notifiable, notifications)
      ].compact
      # Requests a provider never started stay unclaimed and unsettled; the
      # tick re-requests them after its grace period.
      settle_announcement_push(notifiable) if not_started.empty?
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
    when LearnerNudge
      # Reminders (W9.3) use the same per-provider claim as announcements, on
      # the nudge's own outbox columns: a re-request after a crash, a retry or
      # two jobs at once push the learner at most once per provider.
      return if notifiable.push_settled_at || !notifiable.push_requested_at

      notifications = notifications.where(notifiable_type: "LearnerNudge", notifiable_id: notifiable.id)
      evaluator = LearnerNudges.new
      not_started = [
        deliver_nudge_push(WebPushNotificationService, :web_push_attempted_notification_ids, notifiable, notifications, evaluator),
        deliver_nudge_push(ExpoPushNotificationService, :expo_push_attempted_notification_ids, notifiable, notifications, evaluator)
      ].compact
      settle_nudge_push(notifiable) if not_started.empty?
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
    deliver_claimed_push(service, :message_created, attempted_attribute, message, notifications)
  end

  def deliver_nudge_push(service, attempted_attribute, nudge, notifications, evaluator)
    deliver_claimed_push(service, :system_notice, attempted_attribute, nudge, notifications) do
      now = nudge_now
      next false if nudge.push_settled_at || LearnerNudges.quiet_hours?(now)

      candidate = evaluator.current_candidate(nudge, now: now) if nudge.push_requested_at >= now - LearnerNudges::PUSH_MAX_AGE
      if candidate
        candidate unless LearnerNudges.quiet_hours?(nudge_now)
      else
        nudge.update_columns(push_settled_at: now)
        false
      end
    end
  end

  def nudge_now = @clock ? @clock.call : Time.current

  # Marks an update's push done once every notification it has is claimed by
  # both providers. Other recipients' claims may still be in flight in another
  # job; that job settles it when it finishes.
  def settle_announcement_push(announcement)
    announcement.with_lock do
      next if announcement.push_settled_at || (announcement.fanout_requested_at && !announcement.fanout_settled_at)

      ids = Notification.where(notifiable: announcement).pluck(:id)
      claimed = %i[web_push_attempted_notification_ids expo_push_attempted_notification_ids].all? do |attribute|
        (ids - Array(announcement.public_send(attribute)).map(&:to_i)).empty?
      end
      announcement.update_columns(push_settled_at: Time.current) if claimed
    end
  end

  # Settled once both providers have claimed the reminder's notification.
  def settle_nudge_push(nudge)
    nudge.with_lock do
      next if nudge.push_settled_at

      ids = Notification.where(notifiable_type: "LearnerNudge", notifiable_id: nudge.id).pluck(:id)
      claimed = %i[web_push_attempted_notification_ids expo_push_attempted_notification_ids].all? do |attribute|
        (ids - Array(nudge.public_send(attribute)).map(&:to_i)).empty?
      end
      nudge.update_columns(push_settled_at: nudge_now) if claimed
    end
  end

  def deliver_claimed_push(service, method, attempted_attribute, record, notifications)
    requested_ids = notifications.pluck(:id)
    candidate = nil
    # This is an at-most-once provider-attempt boundary. Providers can raise
    # after partial external delivery and expose no transactional idempotency
    # key, so releasing the claim here could notify the same recipient twice.
    # The one exception is a notification whose requests the provider never
    # started (PushDeliveryNotStarted), released below.
    claimed_ids = record.with_lock do
      next [] if record.is_a?(Announcement) && !record.published?
      next [] if record.is_a?(Message) && record.deleted?

      attempted_ids = Array(record.public_send(attempted_attribute)).map(&:to_i)
      next_ids = requested_ids - attempted_ids
      next [] if next_ids.empty?
      if block_given?
        candidate = yield
        next [] unless candidate
      end

      record.update_columns(attempted_attribute => (attempted_ids + next_ids).uniq)
      next_ids
    end
    return if claimed_ids.empty?

    begin
      delivery = Notification.where(id: claimed_ids)
      if candidate
        # Refresh relative dates and lesson details in the outbound copy. The
        # in-app history keeps the text that was recorded when it was sent.
        delivery = delivery.to_a
        delivery.each do |notice|
          notice.assign_attributes(title: candidate.title, body: candidate.body, path: candidate.path)
        end
        if LearnerNudges.quiet_hours?(nudge_now)
          raise PushDeliveryNotStarted.new(provider: service.name, notification_ids: claimed_ids)
        end
      end

      service.public_send(method, record, delivery)
    rescue PushDeliveryNotStarted => not_started
      # The provider's deadline passed before any request for these
      # notifications started, so nothing reached their devices. Releasing
      # the claim lets the next attempt send them; requests that started stay
      # claimed, which keeps the at-most-once boundary above.
      released_ids = not_started.notification_ids & claimed_ids
      release_push_claims(record, attempted_attribute, released_ids)
      return PushDeliveryNotStarted.new(provider: not_started.provider, notification_ids: released_ids) if released_ids.any?
    rescue StandardError => e
      log_provider_failure(service, record, claimed_ids, e)
    end
    nil
  end

  def release_push_claims(record, attempted_attribute, notification_ids)
    return if notification_ids.empty?

    record.with_lock do
      attempted_ids = Array(record.public_send(attempted_attribute)).map(&:to_i)
      changes = { attempted_attribute => attempted_ids - notification_ids }
      # Another job may have settled the update's push while this one was
      # sending (every recipient was claimed then). Unsettle it under the same
      # lock, so the tick re-requests the released recipients (#299 re-check).
      changes[:push_settled_at] = nil if record.is_a?(Announcement) || record.is_a?(LearnerNudge)
      record.update_columns(changes)
    end
    Rails.logger.warn(
      "[PushNotificationJob] provider_not_started_released attribute=#{attempted_attribute} " \
      "#{record.class.name.underscore}_id=#{record.id} notification_ids=#{notification_ids.join(',')}"
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
