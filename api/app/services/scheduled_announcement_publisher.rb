# Posts scheduled updates whose time has come (U-3.6). The hourly
# `scheduled:tick` calls it, so an update goes out at the first tick at or
# after its `scheduled_for`: on the hour it was scheduled for, or within the
# following hour if the tick runs late or the time wasn't on the hour.
#
# Each update is posted exactly as `PATCH status=published` posts a draft,
# and is idempotent the same way: under the announcement's row lock it checks
# that the row is still a scheduled draft that is due, so a second tick, a
# rerun, or a "Post now" racing the tick finds it already posted and does
# nothing. The tick's advisory lock keeps ticks from overlapping as well.
# The in-app notifications are written in the posting transaction; push is
# requested through PushNotificationJob, which ApplicationJob defers until
# every open transaction (the tick's lock included) has committed, so a rolled
# back post never pushes and a push failure never undoes the post (#258).
# Announcements send no email.
#
# Before posting it checks that whoever scheduled the update can still post
# to its audience (an instructor still teaching the cohort, or an admin). If
# not, the update goes back to being an unscheduled draft and nobody is told.
class ScheduledAnnouncementPublisher
  BATCH_SIZE = 100

  class PublishFailed < StandardError; end

  def self.due(now)
    Announcement.scheduled.where(scheduled_for: ..now)
  end

  def self.preview(now)
    { would_publish: due(now).count }
  end

  def initialize(logger: Rails.logger)
    @logger = logger
  end

  # metrics: claimed (due updates found), sent (posted), failed (raised and
  # rolled back; still scheduled, so the next tick retries), refused (the
  # scheduler can no longer post there; now an unscheduled draft).
  def call(now:, metrics: {})
    %i[claimed sent failed refused].each { |key| metrics[key] ||= 0 }
    ids = self.class.due(now).order(:scheduled_for, :id).limit(BATCH_SIZE).pluck(:id)
    ids.each do |id|
      case publish(id, now)
      when :published then metrics[:claimed] += 1; metrics[:sent] += 1
      when :refused then metrics[:claimed] += 1; metrics[:refused] += 1
      end
    rescue StandardError => error
      metrics[:claimed] += 1
      metrics[:failed] += 1
      @logger.error("[ScheduledAnnouncementPublisher] announcement_id=#{id} error=#{error.class}: #{error.message}")
    end
    raise PublishFailed, "#{metrics[:failed]} scheduled update(s) failed to post" if metrics[:failed].positive?

    metrics
  end

  private

  def publish(id, now)
    Announcement.transaction do
      announcement = Announcement.lock.find_by(id: id)
      next :gone unless announcement&.scheduled? && announcement.scheduled_for <= now

      scheduler = announcement.scheduled_by
      unless scheduler && announcement.editable_by?(scheduler) && announcement.postable_by?(scheduler)
        announcement.update!(scheduled_for: nil, scheduled_by: nil, scheduled_send_push: false)
        @logger.warn("[ScheduledAnnouncementPublisher] announcement_id=#{id} unscheduled: scheduler can no longer post to its audience")
        next :refused
      end

      announcement.update!(status: :published)
      NotificationDeliveryService.announcement_published(announcement, push: announcement.scheduled_send_push)
      :published
    end
  end
end
