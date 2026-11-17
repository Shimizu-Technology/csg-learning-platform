# Posts scheduled updates whose time has come (U-3.6), and re-requests pushes
# that a crash left undelivered (the push outbox). The hourly `scheduled:tick`
# calls it, so an update goes out at the first tick at or after its
# `scheduled_for`: on the hour it was scheduled for, or within the following
# hour if the tick runs late or the time wasn't on the hour.
#
# Each update is posted exactly as `PATCH status=published` posts a draft,
# and is idempotent the same way: under the announcement's row lock it checks
# that the row is still a scheduled draft that is due, so a second tick, a
# rerun, or a "Post now" racing the tick finds it already posted and does
# nothing. The tick's advisory lock keeps ticks from overlapping as well.
# The in-app notifications are written in the posting transaction. Push is
# requested through PushNotificationJob, which ApplicationJob defers until
# every open transaction (the tick's lock included) has committed, so a rolled
# back post never pushes and a push failure never undoes the post (#258).
# Announcements send no email.
#
# The push outbox. Posting with push sets `push_requested_at` in the same
# UPDATE that posts, so the intent is durable the moment the post is. The job
# claims each recipient per provider under the row lock before sending and
# sets `push_settled_at` when both providers have claimed everyone. If the
# process dies between the commit and the push (or part-way through it), the
# intent stays unsettled; after PUSH_GRACE this re-requests it, and the job
# sends only to recipients no provider claim covers yet. That holds for
# updates posted from a request too, not only scheduled ones. A push still
# unsettled after PUSH_MAX_AGE is settled without sending: a day-old alert
# would be noise.
#
# Before posting it checks that whoever scheduled the update can still post
# to its audience (an instructor still teaching the cohort, or an admin). If
# not, the update goes back to being an unscheduled draft and nobody is told.
#
# It drains everything due in batches of BATCH_SIZE until nothing is left or
# the time budget runs out. Running out raises BacklogRemaining, so the tick
# records the task as failed, leaves its hourly checkpoint where it was, and
# the next run (even within the same hour) carries on.
class ScheduledAnnouncementPublisher
  BATCH_SIZE = 100
  TIME_BUDGET = 300 # seconds per run
  PUSH_GRACE = 5.minutes
  PUSH_MAX_AGE = 24.hours

  class PublishFailed < StandardError; end
  class BacklogRemaining < StandardError; end

  def self.due(now)
    Announcement.scheduled.where(scheduled_for: ..now)
  end

  def self.push_due(now)
    Announcement.push_pending.where(push_requested_at: ..(now - PUSH_GRACE))
  end

  def self.preview(now)
    { would_publish: due(now).count, would_requeue_push: push_due(now).count }
  end

  def initialize(logger: Rails.logger, batch_size: BATCH_SIZE, time_budget: TIME_BUDGET)
    @logger, @batch_size, @time_budget = logger, batch_size, time_budget
  end

  # metrics: claimed (due updates found), sent (posted), failed (raised and
  # rolled back; still scheduled, so the next run retries), refused (the
  # scheduler can no longer post there; now an unscheduled draft),
  # push_requeued and push_expired (the outbox).
  def call(now:, metrics: {})
    %i[claimed sent failed refused push_requeued push_expired].each { |key| metrics[key] ||= 0 }
    @started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    failed_ids = []
    drained = drain(self.class.due(now).order(:scheduled_for, :id)) do |relation|
      relation.where.not(id: failed_ids).limit(@batch_size).pluck(:id).each do |id|
        case publish(id, now)
        when :published then metrics[:claimed] += 1; metrics[:sent] += 1
        when :refused then metrics[:claimed] += 1; metrics[:refused] += 1
        end
      rescue StandardError => error
        failed_ids << id
        metrics[:claimed] += 1
        metrics[:failed] += 1
        @logger.error("[ScheduledAnnouncementPublisher] announcement_id=#{id} error=#{error.class}: #{error.message}")
      end
    end
    # A requested job may only run once the tick's lock commits, so this run
    # skips the updates it has already requested.
    requested_ids = []
    drained &&= drain(self.class.push_due(now).order(:push_requested_at, :id)) do |relation|
      relation.where.not(id: requested_ids).limit(@batch_size).pluck(:id, :push_requested_at).each do |id, requested_at|
        requested_ids << id
        requeue_push(id, requested_at, now, metrics)
      end
    end
    raise PublishFailed, "#{metrics[:failed]} scheduled update(s) failed to post" if metrics[:failed].positive?
    raise BacklogRemaining, "time budget spent with work still due; the next run continues" unless drained

    metrics
  end

  private

  # Runs batches until one comes back short (nothing left after it), or the
  # budget is spent. True when everything was drained.
  def drain(relation)
    loop do
      found = yield(relation)
      return true if found.size < @batch_size
      return false if Process.clock_gettime(Process::CLOCK_MONOTONIC) - @started > @time_budget
    end
  end

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

      # The push intent commits in the same UPDATE as the post (the outbox).
      announcement.update!(status: :published, push_requested_at: (Time.current if announcement.scheduled_send_push))
      NotificationDeliveryService.announcement_published(announcement, push: announcement.scheduled_send_push)
      :published
    end
  end

  # Re-requests an unsettled push, or settles one too old to be worth sending.
  # The job claims recipients itself, so a request racing a job still running
  # can't push anyone twice.
  def requeue_push(id, requested_at, now, metrics)
    if requested_at < now - PUSH_MAX_AGE
      Announcement.where(id: id, push_settled_at: nil).update_all(push_settled_at: now)
      metrics[:push_expired] += 1
      @logger.warn("[ScheduledAnnouncementPublisher] announcement_id=#{id} push_expired requested_at=#{requested_at.iso8601}")
      return
    end

    PushNotificationJob.perform_later("Announcement", id, Notification.where(notifiable_type: "Announcement", notifiable_id: id).pluck(:id))
    metrics[:push_requeued] += 1
  end
end
