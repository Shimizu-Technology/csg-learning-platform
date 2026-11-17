# Async is an optimization only: the durable intent is recovered by the tick.
# Large publications enqueue here instead of executing fan-out on the request.
class AnnouncementFanoutJob < ApplicationJob
  self.queue_adapter = :async

  def perform(id)
    loop do
      done = Announcement.transaction do
        announcement = Announcement.lock.find_by(id: id)
        next true unless announcement && announcement.fanout_requested_at && !announcement.fanout_settled_at

        unless announcement.published?
          announcement.update_columns(fanout_settled_at: Time.current, push_settled_at: Time.current)
          next true
        end

        ids = announcement.fanout_recipient_ids.drop_while { |user_id| user_id <= announcement.fanout_cursor }
          .first(NotificationDeliveryService::ANNOUNCEMENT_BATCH_SIZE)
        # Deleted/archived accounts are skipped, while the immutable publication
        # snapshot prevents later enrollments from receiving an old alert.
        active_ids = User.not_archived.where(id: ids).pluck(:id)
        NotificationDeliveryService.new.announcement_batch(announcement, active_ids)
        finished = ids.size < NotificationDeliveryService::ANNOUNCEMENT_BATCH_SIZE
        changes = { fanout_cursor: ids.last || announcement.fanout_cursor }
        changes[:fanout_settled_at] = Time.current if finished
        announcement.update_columns(changes)
        finished
      end
      break if done
    end

    announcement = Announcement.find_by(id: id)
    return unless announcement&.published? && announcement.fanout_settled_at && announcement.push_requested_at && !announcement.push_settled_at

    if announcement.push_requested_at < Time.current - ScheduledAnnouncementPublisher::PUSH_MAX_AGE
      announcement.with_lock { announcement.update_columns(push_settled_at: Time.current) }
      return
    end

    PushNotificationJob.perform_later("Announcement", id, announcement.notifications.pluck(:id))
  end
end
