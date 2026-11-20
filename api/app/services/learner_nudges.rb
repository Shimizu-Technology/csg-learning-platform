# Learner reminders (W9.3, AS-4), run by the hourly `scheduled:tick`.
#
# What a learner can get, each once per event and threshold:
# - due_soon: a plan milestone (24h before the end of its Guam due day) or the
#   final project (48h and 24h before its effective close time). Dates are the
#   learner's effective ones: milestones from LearnerProgress#pace (which a
#   final-date extension shifts) and the final project's close time from the
#   W9.2 resolver (SubmissionWindowContext, extensions included). The key holds
#   the date, so after an extension the old date is no longer a candidate and
#   the new one gets its own reminders.
# - inactive: no learning activity (LearnerActivity) for 7 or 14 days, after
#   the learner's start, while a required lesson is open and unfinished or a
#   redo is waiting. The key holds the last activity, so new work starts a
#   new streak.
# - support_ending: instructor support ends within 7 days, then 1 day. Skipped
#   when access ends within a day of it (the access notice covers both).
# - access_ending: access ends within 14 days, then 3 days. This one is
#   essential: losing access is a change to what the learner bought or was
#   given, and after it they can't open lessons or their own work, so it is
#   sent even to a learner who turned reminders off, and the daily cap never
#   holds it back. Everything else is optional and follows that preference
#   (`users.learner_nudges_enabled`).
#
# Who: active (not paused, dropped, completed or expired), signed-up students
# in active, non-alumni cohorts where both the school `learner_nudges` switch
# and the cohort's own opt-in are on (FeatureSwitches::COHORT_OPT_IN). With the
# school switch off the task reads one row and stops; cohorts that haven't
# opted in add no queries and get no rows.
#
# At most one reminder per learner per Guam day: the most urgent is sent and
# the rest are considered again on later ticks (a passed date simply drops
# out). An access notice is never held back, and on its day optional ones wait. Nothing is sent from 21:00 to 08:00 Guam time; the first tick at
# or after 08:00 evaluates everything again with current dates, so a deferred
# reminder whose date moved overnight is not sent for the old date.
#
# Delivery: the LearnerNudge row (unique key) and its in-app notification are
# inserted in one transaction, which is the exactly-once claim. Email and push
# go out after it commits, at most once: email is attempted once and its result
# recorded on the row; push uses PushNotificationJob's per-provider claim and
# the row's outbox columns, and a push a crash left unsettled is re-requested
# after PUSH_GRACE (or dropped after PUSH_MAX_AGE).
#
# Enrollments are read in id batches until done or TIME_BUDGET runs out
# (BacklogRemaining, so the tick retries without moving its checkpoint). A
# failure while evaluating one learner is logged and skipped; the others still
# get theirs, and the task reports failure so the next tick tries again.
class LearnerNudges
  GUAM = "Pacific/Guam".freeze
  BATCH_SIZE = 200
  TIME_BUDGET = 300 # seconds per run
  QUIET_FROM_HOUR = 21
  QUIET_UNTIL_HOUR = 8
  PUSH_GRACE = 5.minutes
  PUSH_MAX_AGE = 12.hours
  # Smallest first: the tightest threshold the remaining time falls within.
  BEFORE = {
    "milestone" => [ [ "24h", 24.hours ] ],
    "final" => [ [ "24h", 24.hours ], [ "48h", 48.hours ] ],
    "support_ending" => [ [ "1d", 1.day ], [ "7d", 7.days ] ],
    "access_ending" => [ [ "3d", 3.days ], [ "14d", 14.days ] ]
  }.freeze
  # Largest first: the longest stretch of inactivity reached.
  INACTIVE_AFTER = [ [ "14d", 14.days ], [ "7d", 7.days ] ].freeze

  # Resend allows a few requests a second per account; space reminder emails
  # so a shared 08:00 deadline doesn't turn into rate-limit failures.
  class_attribute :email_interval, default: 0.6 # seconds between emails

  class EvaluationFailed < StandardError; end
  class BacklogRemaining < StandardError; end

  Candidate = Data.define(:enrollment, :kind, :threshold, :key, :essential, :event_at, :title, :body, :path, :priority)

  def self.quiet_hours?(now)
    hour = now.in_time_zone(GUAM).hour
    hour >= QUIET_FROM_HOUR || hour < QUIET_UNTIL_HOUR
  end

  # Whether a cohort's learners can get reminders (staff workspace, profile):
  # the same rule the tick applies, so the alumni library never shows them.
  def self.enabled_for?(cohort, school: nil)
    !cohort.alumni? && FeatureSwitches.for(cohort: cohort, school: school)["learner_nudges"] == true
  end

  def self.preview(now)
    new.preview(now: now)
  end

  def initialize(logger: Rails.logger, batch_size: BATCH_SIZE, time_budget: TIME_BUDGET)
    @logger, @batch_size, @time_budget = logger, batch_size, time_budget
  end

  # Dry run: what the next real run would send now, with no writes.
  def preview(now: Time.current)
    school = FeatureSwitches.school(read_only: true)
    return { would_claim: 0, enabled: false } unless school["learner_nudges"] == true
    return { would_claim: 0, quiet_hours: true } if self.class.quiet_hours?(now)

    @started = monotonic
    metrics = { failed: 0 }
    count = 0
    cohort_ids = opted_in_cohort_ids(now)
    each_batch(cohort_ids, now, 0, metrics) { |batch| count += choose(batch, now, school, metrics).size } if cohort_ids.any?
    { would_claim: count, cohorts: cohort_ids.size, failed: metrics[:failed] }
  end

  # metrics: claimed (reminders newly recorded), sent (delivered in-app, with
  # email and push attempted), failed (learners whose evaluation raised),
  # email_failed, push_requeued and push_expired (the outbox), and
  # resume_after (the last enrollment checked when the budget ran out; the
  # tick keeps it in the task's last_result and the next run starts after it).
  def call(now:, metrics: {})
    %i[claimed sent failed email_failed push_requeued push_expired].each { |key| metrics[key] ||= 0 }
    school = FeatureSwitches.school(read_only: true)
    return metrics unless school["learner_nudges"] == true
    if self.class.quiet_hours?(now)
      metrics[:quiet_hours] = true
      return metrics
    end

    @started = monotonic
    recover_pushes(now, metrics)
    cohort_ids = opted_in_cohort_ids(now)
    drained = cohort_ids.empty? || each_batch(cohort_ids, now, resume_after, metrics) { |batch| deliver(claim(choose(batch, now, school, metrics), now, metrics), now, metrics) }
    raise EvaluationFailed, "#{metrics[:failed]} learner(s) could not be evaluated" if metrics[:failed].positive?
    raise BacklogRemaining, "time budget spent with learners still to check; the next run continues" unless drained

    metrics
  end

  private

  # Running cohorts, plus completed ones: their learners keep access until
  # it expires, so the essential access notice still reaches them.
  def opted_in_cohort_ids(now)
    today = now.in_time_zone(GUAM).to_date
    Cohort.active(on: today).or(Cohort.completed).where.not(cohort_type: :alumni)
      .where("cohorts.settings -> 'features' ->> 'learner_nudges' = 'true'").pluck(:id)
  end

  def resume_after
    ScheduledTaskRun.find_by(name: "learner_nudges")&.last_result&.dig("resume_after").to_i
  end

  # Yields each batch of candidate enrollments, starting after `start` and
  # wrapping round to the lowest ids, so a run cut short by the budget never
  # starves learners with higher ids. True when every batch ran.
  def each_batch(cohort_ids, now, start, metrics)
    ranges = start.positive? ? [ [ start, nil ], [ 0, start ] ] : [ [ 0, nil ] ]
    ranges.each do |cursor, stop|
      loop do
        scope = Enrollment.active(at: now).where(cohort_id: cohort_ids).where("enrollments.id > ?", cursor)
        scope = scope.where("enrollments.id <= ?", stop) if stop
        batch = scope.joins(:user).where(users: { archived_at: nil, role: User.roles.fetch("student") })
          .includes(:user, :cohort).order(:id).limit(@batch_size).to_a
        break if batch.empty?

        yield batch
        cursor = batch.last.id
        break if batch.size < @batch_size
        next unless monotonic - @started > @time_budget

        metrics[:resume_after] = cursor
        return false
      end
    end
    true
  end

  # The reminders to send now for one batch: due, not already sent, and within
  # the daily cap. Reads a fixed number of queries however large the batch.
  def choose(batch, now, school, metrics)
    batch = batch.reject { |enrollment| enrollment.user.invite_pending? }
    return [] if batch.empty?

    projections = progress_for(batch, now, school, metrics)
    activity = LearnerActivity.for_all(batch)
    candidates = batch.flat_map do |enrollment|
      progress = projections[enrollment.id]
      next [] unless progress

      candidates_for(enrollment, progress, activity[enrollment.id], now)
    rescue StandardError => error
      metrics[:failed] += 1
      @logger.error("[LearnerNudges] enrollment_id=#{enrollment.id} evaluation_failed=#{error.class}: #{error.message}")
      []
    end
    return [] if candidates.empty?

    sent = LearnerNudge.where(key: candidates.map(&:key)).pluck(:key).to_set
    fresh = candidates.reject { |candidate| sent.include?(candidate.key) }
    return [] if fresh.empty?

    today = now.in_time_zone(GUAM).to_date
    reminded_today = LearnerNudge.where(enrollment_id: fresh.map { |candidate| candidate.enrollment.id }.uniq, school_date: today).distinct.pluck(:enrollment_id).to_set
    fresh.group_by { |candidate| candidate.enrollment.id }.flat_map do |enrollment_id, items|
      items = items.sort_by(&:priority)
      essential = items.find(&:essential)
      if essential then [ essential ]
      elsif reminded_today.include?(enrollment_id) then []
      else [ items.first ]
      end
    end
  end

  # One learner's bad data must not cost the batch: on a batch failure each
  # learner is projected on their own and only the failing ones are skipped.
  def progress_for(batch, now, school, metrics)
    LearnerProgress.for_all(batch, now: now, school_features: school)
  rescue StandardError => batch_error
    @logger.warn("[LearnerNudges] batch_projection_failed=#{batch_error.class}; projecting learners one at a time")
    batch.each_with_object({}) do |enrollment, result|
      result[enrollment.id] = LearnerProgress.new(enrollment, now: now, school_features: school)
    rescue StandardError => error
      metrics[:failed] += 1
      @logger.error("[LearnerNudges] enrollment_id=#{enrollment.id} evaluation_failed=#{error.class}: #{error.message}")
    end
  end

  def candidates_for(enrollment, progress, last_active_at, now)
    list = access_ending(enrollment, now)
    # A completed cohort keeps only the essential access notice.
    return list unless enrollment.user.learner_nudges_enabled? && enrollment.cohort.active?

    list + due_soon(enrollment, progress, now) + support_ending(enrollment, now) + inactive(enrollment, progress, last_active_at, now)
  end

  def due_soon(enrollment, progress, now)
    cohort = enrollment.cohort
    list = []
    final = LearnerPace.final_project_lesson(progress)
    final_entry = final && progress.lesson_progress(final)
    close_at = final_entry&.submission_window&.dig(:submissions_close_at)
    if close_at && final_entry.available && !final_entry.completed && (threshold = before("final", close_at, now))
      list << Candidate.new(enrollment: enrollment, kind: "due_soon", threshold: threshold, essential: false, event_at: close_at, priority: 1,
        key: "due_soon/#{enrollment.id}/final/#{close_at.utc.iso8601}/#{threshold}",
        title: "Final project due #{day_phrase(close_at, now)}",
        body: "#{final.title} is due by #{close_at.in_time_zone(GUAM).strftime('%-l:%M %p')} Guam time.",
        path: LearningDestination.lesson(lesson_id: final.id, cohort_id: cohort.id))
    end

    milestones = progress.pace&.dig(:milestones) || []
    milestones.reject { |milestone| milestone[:status] == "done" }.group_by { |milestone| milestone[:due_on] }.each do |due_on, group|
      open = group.flat_map { |milestone| milestone[:lessons] }.uniq.select do |lesson|
        entry = progress.lesson_progress(lesson)
        lesson.id != final&.id && entry.available && !entry.completed
      end
      next if open.empty?

      due_at = ActiveSupport::TimeZone[GUAM].local(due_on.year, due_on.month, due_on.day).end_of_day
      threshold = before("milestone", due_at, now)
      next unless threshold

      title = group.map { |milestone| milestone[:title] }.compact_blank.uniq.join(", ").presence || "Your plan"
      list << Candidate.new(enrollment: enrollment, kind: "due_soon", threshold: threshold, essential: false, event_at: due_at, priority: 2,
        key: "due_soon/#{enrollment.id}/milestone/#{due_on.iso8601}/#{threshold}",
        title: "#{title}: due #{day_phrase(due_at, now)}",
        body: "#{open.size} #{open.size == 1 ? 'lesson' : 'lessons'} left: #{lesson_list(open)}.",
        path: LearningDestination.lesson(lesson_id: open.first.id, cohort_id: cohort.id))
    end
    list
  end

  def inactive(enrollment, progress, last_active_at, now)
    cohort = enrollment.cohort
    starts_on = enrollment.personal_start_on(cohort) || cohort.start_date
    return [] unless starts_on && progress.today >= starts_on

    open_work = progress.redo_submissions.any? || progress.lessons.any? do |lesson|
      entry = progress.lesson_progress(lesson)
      progress.required?(lesson) && entry.total_blocks.positive? && entry.available && !entry.completed
    end
    return [] unless open_work

    started_at = ActiveSupport::TimeZone[GUAM].local(starts_on.year, starts_on.month, starts_on.day)
    since = [ last_active_at, enrollment.first_opened_at, enrollment.enrolled_at || enrollment.created_at, started_at ].compact.max
    threshold, span = INACTIVE_AFTER.find { |_, length| now - since >= length }
    return [] unless threshold

    days = ((now - since) / 1.day).floor
    next_lesson = progress.next_lesson
    started = last_active_at || enrollment.first_opened_at
    [ Candidate.new(enrollment: enrollment, kind: "inactive", threshold: threshold, essential: false, event_at: since, priority: 4,
      key: "inactive/#{enrollment.id}/#{since.to_i}/#{threshold}",
      title: started ? "Pick up where you left off" : "Your course is ready when you are",
      body: "#{started ? "It's been #{days} days since your last activity in #{cohort.name}." : "You haven't started #{cohort.name} yet."}#{" Next up: #{next_lesson.title}." if next_lesson}",
      path: next_lesson ? LearningDestination.lesson(lesson_id: next_lesson.id, cohort_id: cohort.id) : "/cohorts/#{cohort.id}") ]
  end

  def support_ending(enrollment, now)
    cohort = enrollment.cohort
    ends_at = enrollment.support_expires_at
    return [] unless ends_at && ends_at > now && enrollment.instructor_support_active?
    return [] if cohort.self_paced? && cohort.support_instructor_id.nil?
    return [] if enrollment.access_expires_at && enrollment.access_expires_at - ends_at < 1.day

    threshold = before("support_ending", ends_at, now)
    return [] unless threshold

    access = enrollment.access_expires_at
    [ Candidate.new(enrollment: enrollment, kind: "support_ending", threshold: threshold, essential: false, event_at: ends_at, priority: 3,
      key: "support_ending/#{enrollment.id}/#{ends_at.to_i}/#{threshold}",
      title: "Your help period ends #{day_phrase(last_moment(ends_at), now)}",
      body: "Until then, use Ask for help on a lesson to reach #{cohort.name} staff. Your lessons stay open#{access ? " through #{last_moment(access).in_time_zone(GUAM).strftime('%b %-d, %Y')}" : ''}.",
      path: "/cohorts/#{cohort.id}") ]
  end

  def access_ending(enrollment, now)
    ends_at = enrollment.access_expires_at
    return [] unless ends_at && ends_at > now

    threshold = before("access_ending", ends_at, now)
    return [] unless threshold

    cohort = enrollment.cohort
    [ Candidate.new(enrollment: enrollment, kind: "access_ending", threshold: threshold, essential: true, event_at: ends_at, priority: 0,
      key: "access_ending/#{enrollment.id}/#{ends_at.to_i}/#{threshold}",
      title: "Your access to #{cohort.name} ends #{day_phrase(last_moment(ends_at), now)}",
      body: "After that you can't open its lessons or hand in work. Finish what you're working on and save anything you want to keep.",
      path: "/cohorts/#{cohort.id}") ]
  end

  def before(type, at, now)
    remaining = at - now
    return nil unless remaining.positive?

    BEFORE.fetch(type).find { |_, span| remaining <= span }&.first
  end

  # The last moment something is still open. Guided terms end at 00:00 Guam
  # on the day after the last day, so that midnight belongs to the day before.
  def last_moment(ends_at) = ends_at - 1.second

  def day_phrase(at, now)
    local = at.in_time_zone(GUAM)
    case (local.to_date - now.in_time_zone(GUAM).to_date).to_i
    when 0 then "today"
    when 1 then "tomorrow"
    else local.strftime("%a, %b %-d")
    end
  end

  def lesson_list(lessons)
    names = lessons.first(2).map(&:title)
    rest = lessons.size - names.size
    rest.positive? ? "#{names.join(', ')} and #{rest} more" : names.to_sentence(two_words_connector: " and ", last_word_connector: " and ")
  end

  # Records each chosen reminder and its in-app notification together. Only
  # rows this call inserted come back, so a concurrent or repeated run that
  # lost the key sends nothing.
  def claim(chosen, now, metrics)
    return [] if chosen.empty?

    today = now.in_time_zone(GUAM).to_date
    marker = ProviderEmailProvenance.marker
    claimed = LearnerNudge.transaction do
      rows = chosen.map do |candidate|
        { enrollment_id: candidate.enrollment.id, kind: candidate.kind, threshold: candidate.threshold, key: candidate.key,
          essential: candidate.essential, event_at: candidate.event_at, school_date: today, title: candidate.title,
          body: candidate.body, path: candidate.path, push_requested_at: now, created_at: now, updated_at: now }
      end
      ids = LearnerNudge.insert_all(rows, unique_by: :index_learner_nudges_on_key, returning: %w[id key], record_timestamps: false).rows.to_h { |id, key| [ key, id ] }
      won = chosen.filter_map { |candidate| [ candidate, ids[candidate.key] ] if ids[candidate.key] }
      next [] if won.empty?

      notices = won.map do |candidate, id|
        { user_id: candidate.enrollment.user_id, notifiable_type: "LearnerNudge", notifiable_id: id, actor_id: nil,
          notification_type: Notification.notification_types.fetch("system"), title: candidate.title, body: candidate.body,
          path: candidate.path, email_application: marker, created_at: now, updated_at: now }
      end
      notification_ids = Notification.insert_all(notices, unique_by: :index_notifications_unique_source_per_user,
        returning: %w[id notifiable_id], record_timestamps: false).rows.to_h { |id, nudge_id| [ nudge_id, id ] }
      won.map { |candidate, id| [ candidate, id, notification_ids[id] ] }
    end
    metrics[:claimed] += claimed.size
    claimed
  end

  def deliver(claimed, _now, metrics)
    return if claimed.empty?

    email_ready = NotificationEmailService.configured?
    claimed.each do |candidate, id, notification_id|
      status = if !email_ready then "not_configured"
      elsif candidate.enrollment.user.email.blank? then "no_address"
      else
        pace_email
        NotificationEmailService.send_learner_nudge(user: candidate.enrollment.user, cohort: candidate.enrollment.cohort,
          title: candidate.title, body: candidate.body, path: candidate.path, essential: candidate.essential) ? "sent" : "failed"
      end
      # Recorded per reminder, so a crash later in the batch can't hide a sent email.
      LearnerNudge.where(id: id).update_all(email_status: status) unless status == "not_requested"
      metrics[:email_failed] += 1 if status == "failed"
      push(id, notification_id)
      metrics[:sent] += 1
    end
  end

  def pace_email
    wait = @last_email_at && email_interval - (monotonic - @last_email_at)
    sleep(wait) if wait&.positive?
    @last_email_at = monotonic
  end

  def push(nudge_id, notification_id)
    PushNotificationJob.perform_now("LearnerNudge", nudge_id, [ notification_id ].compact)
  rescue StandardError => error
    # The outbox stays unsettled, so the next tick re-requests what wasn't claimed.
    @logger.error("[LearnerNudges] learner_nudge_id=#{nudge_id} push_failed=#{error.class}: #{error.message}")
  end

  # Re-requests pushes a crash left unsettled, and drops ones too old to help.
  def recover_pushes(now, metrics)
    due = LearnerNudge.push_pending.where(push_requested_at: ..(now - PUSH_GRACE)).order(:id).limit(@batch_size).to_a
    return if due.empty?

    expired, again = due.partition { |nudge| nudge.push_requested_at < now - PUSH_MAX_AGE }
    if expired.any?
      LearnerNudge.where(id: expired.map(&:id), push_settled_at: nil).update_all(push_settled_at: now)
      metrics[:push_expired] += expired.size
    end
    return if again.empty?

    notifications = Notification.where(notifiable_type: "LearnerNudge", notifiable_id: again.map(&:id)).pluck(:notifiable_id, :id).to_h
    again.each do |nudge|
      push(nudge.id, notifications[nudge.id])
      metrics[:push_requeued] += 1
    end
  end

  def monotonic = Process.clock_gettime(Process::CLOCK_MONOTONIC)
end
