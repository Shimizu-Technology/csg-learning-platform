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
# school switch off the task only settles old deliveries; cohorts that
# haven't opted in get no rows.
#
# At most one reminder per learner per Guam day: the most urgent is sent and
# the rest are considered again on later ticks (a passed date simply drops
# out). An access notice is never held back, and on its day optional ones wait. Nothing is sent from 21:00 to 08:00 Guam time; the first tick at
# or after 08:00 evaluates everything again with current dates, so a deferred
# reminder whose date moved overnight is not sent for the old date.
#
# Delivery: the LearnerNudge row (unique key) and its in-app notification are
# inserted in one transaction, which is the exactly-once claim. Email and push
# go out after it commits, at most once. Recovery rechecks eligibility before
# sending pending email or push, and settles deliveries that are too old.
#
# Enrollments are read in id batches until done or TIME_BUDGET runs out
# (BacklogRemaining, so the tick retries without moving its checkpoint). A
# failure while evaluating one learner is logged and skipped; the others still
# get theirs, and the task reports failure so the next tick tries again.
class LearnerNudges
  GUAM = LearningCalendar::TIMEZONE
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

  def initialize(logger: Rails.logger, batch_size: BATCH_SIZE, time_budget: TIME_BUDGET, clock: -> { Time.current })
    @logger, @batch_size, @time_budget, @clock = logger, batch_size, time_budget, clock
  end

  # Dry run: what the next real run would send now, with no writes.
  def preview(now: Time.current)
    school = FeatureSwitches.school(read_only: true)
    return { would_claim: 0, enabled: false } unless school["learner_nudges"] == true
    return { would_claim: 0, quiet_hours: true } if self.class.quiet_hours?(now)

    @started = monotonic
    metrics = { failed: 0 }
    count = 0
    scope = eligible_enrollments(now)
    planned = Set.new
    each_batch(scope, metrics, start: 0, boundary: scope.maximum(:id).to_i, live: false) do |batch|
      selected = select_daily(choose(batch, now, school, metrics), LearningCalendar.today(at: now), planned)
      count += selected.size
      planned.merge(selected.map { |candidate| candidate.enrollment.user_id })
      true
    end
    { would_claim: count, cohorts: opted_in_cohorts(now).count, failed: metrics[:failed] }
  end

  # metrics: claimed (reminders newly recorded), sent (delivered in-app),
  # failed (learner evaluations that raised),
  # email_failed, push_requeued and push_expired (the outbox), and
  # resume_after and sweep_boundary (the last checked enrollment and the
  # highest id in the sweep, retained across ticks until the sweep finishes).
  def call(now:, metrics: {})
    %i[claimed sent failed email_failed push_requeued push_expired].each { |key| metrics[key] ||= 0 }
    school = FeatureSwitches.school(read_only: true)
    if self.class.quiet_hours?(now)
      metrics[:quiet_hours] = true
      metrics.merge!(scan_checkpoint.symbolize_keys)
      return metrics
    end

    @started = monotonic
    recover_deliveries(now, metrics)
    return metrics unless school["learner_nudges"] == true

    checkpoint = scan_checkpoint
    scope = eligible_enrollments(now)
    boundary = checkpoint["sweep_boundary"] || scope.maximum(:id).to_i
    drained = each_batch(scope, metrics, start: checkpoint["resume_after"].to_i, boundary: boundary) do |batch|
      chosen = choose(batch, now, school, metrics)
      claimed = claim(chosen, metrics)
      next false unless claimed

      deliver(claimed, metrics)
      true
    end
    raise EvaluationFailed, "#{metrics[:failed]} learner(s) could not be evaluated" if metrics[:failed].positive?
    raise BacklogRemaining, "time budget spent with learners still to check; the next run continues" unless drained || metrics[:quiet_hours]

    metrics
  end

  # Rebuild only the event this outbox row refers to, from current settings
  # and progress. A different event date, inactivity streak, or tighter
  # threshold gets evaluated independently by the regular enrollment scan.
  def current_candidate(nudge, now:)
    LearnerNudge.uncached do
      school = FeatureSwitches.school(read_only: true)
      next unless school["learner_nudges"]

      enrollment = eligible_enrollments(now).includes(:user, :cohort).find_by(id: nudge.enrollment_id)
      next unless enrollment && !enrollment.user.invite_pending?

      candidates = if nudge.kind == "access_ending"
        access_ending(enrollment, now)
      elsif optional_for?(enrollment)
        case nudge.kind
        when "support_ending" then support_ending(enrollment, now)
        when "due_soon" then due_soon(enrollment, LearnerProgress.new(enrollment, now: now, school_features: school), now)
        when "inactive"
          inactive(enrollment, LearnerProgress.new(enrollment, now: now, school_features: school), LearnerActivity.last_active_at(enrollment), now)
        end
      end
      candidates&.find { |candidate| candidate.key == nudge.key }
    end
  end

  private

  # Running cohorts, plus completed ones: their learners keep access until
  # it expires, so the essential access notice still reaches them.
  def opted_in_cohorts(now)
    Cohort.active(on: LearningCalendar.today(at: now)).or(Cohort.completed).where.not(cohort_type: :alumni)
      .where("cohorts.settings -> 'features' ->> 'learner_nudges' = 'true'")
  end

  def eligible_enrollments(now)
    Enrollment.active(at: now).where(cohort_id: opted_in_cohorts(now).select(:id)).joins(:user)
      .where(users: { archived_at: nil, role: User.roles.fetch("student") })
  end

  def quiet_now?(metrics)
    return false unless self.class.quiet_hours?(@clock.call)

    metrics[:quiet_hours] = true
  end

  def scan_checkpoint
    result = ScheduledTaskRun.find_by(name: "learner_nudges")&.last_result || {}
    result.slice("resume_after", "sweep_boundary")
  end

  # One sweep per run. New ids beyond the boundary wait for the next sweep,
  # and a short tail completes this sweep without wrapping to its first page.
  def each_batch(scope, metrics, start:, boundary:, live: true)
    cursor = start
    while cursor < boundary
      if (live && quiet_now?(metrics)) || monotonic - @started >= @time_budget
        metrics.merge!(resume_after: cursor, sweep_boundary: boundary)
        return false
      end

      batch = scope.where(id: (cursor + 1)..boundary).includes(:user, :cohort).order(:id).limit(@batch_size).to_a
      break if batch.empty?
      unless yield batch
        metrics.merge!(resume_after: cursor, sweep_boundary: boundary)
        return false
      end

      cursor = batch.last.id
      break if batch.size < @batch_size
    end
    true
  end

  # New events due in this batch, evaluated with a fixed number of queries.
  def choose(batch, now, school, metrics)
    batch = batch.reject { |enrollment| enrollment.user.invite_pending? }
    return [] if batch.empty?

    candidates = batch.flat_map { |enrollment| evaluate(enrollment.id, metrics) { access_ending(enrollment, now) } }
    optional = batch.select { |enrollment| optional_for?(enrollment) }
    projections = progress_for(optional, now, school, metrics)
    activity = activity_for(optional, metrics)
    candidates.concat(optional.flat_map do |enrollment|
      progress = projections[enrollment.id]
      next [] unless progress && activity.key?(enrollment.id)

      evaluate(enrollment.id, metrics) { candidates_for(enrollment, progress, activity[enrollment.id], now) }
    end)
    return [] if candidates.empty?

    sent = LearnerNudge.where(key: candidates.map(&:key)).pluck(:key).to_set
    candidates.reject { |candidate| sent.include?(candidate.key) }
  end

  def select_daily(candidates, today, planned = Set.new)
    by_user = candidates.group_by { |candidate| candidate.enrollment.user_id }
    optional_users = by_user.keys - planned.to_a
    reminded = LearnerNudge.uncached do
      LearnerNudge.joins(:enrollment).where(enrollments: { user_id: optional_users }, school_date: today)
        .distinct.pluck("enrollments.user_id").to_set
    end
    by_user.flat_map do |user_id, items|
      essential = items.select(&:essential)
      next essential if essential.any?
      next [] if reminded.include?(user_id) || planned.include?(user_id)

      [ items.min_by(&:priority) ]
    end
  end

  def optional_for?(enrollment)
    enrollment.user.learner_nudges_enabled? && enrollment.cohort.active?
  end

  def evaluate(enrollment_id, metrics)
    yield
  rescue StandardError => error
    metrics[:failed] += 1
    @logger.error("[LearnerNudges] enrollment_id=#{enrollment_id} evaluation_failed=#{error.class}: #{error.message}")
    []
  end

  # One learner's bad data must not cost the batch: on a batch failure each
  # learner is projected on their own and only the failing ones are skipped.
  def progress_for(batch, now, school, metrics)
    LearnerProgress.for_all(batch, now: now, school_features: school)
  rescue StandardError => batch_error
    @logger.warn("[LearnerNudges] batch_projection_failed=#{batch_error.class}; projecting learners one at a time")
    batch.each_with_object({}) do |enrollment, result|
      evaluate(enrollment.id, metrics) { result[enrollment.id] = LearnerProgress.new(enrollment, now: now, school_features: school) }
    end
  end

  def activity_for(batch, metrics)
    LearnerActivity.for_all(batch)
  rescue StandardError => batch_error
    @logger.warn("[LearnerNudges] batch_activity_failed=#{batch_error.class}; checking learners one at a time")
    batch.each_with_object({}) do |enrollment, result|
      evaluate(enrollment.id, metrics) { result[enrollment.id] = LearnerActivity.last_active_at(enrollment) }
    end
  end

  def candidates_for(enrollment, progress, last_active_at, now)
    due_soon(enrollment, progress, now) + support_ending(enrollment, now) + inactive(enrollment, progress, last_active_at, now)
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
  def claim(chosen, metrics)
    return if quiet_now?(metrics)
    return [] if chosen.empty?

    marker = ProviderEmailProvenance.marker
    claimed = LearnerNudge.transaction do
      # Lock in user id order across competing ticks, then read the cap on
      # this connection without reusing any pre-lock query result.
      User.where(id: chosen.map { |candidate| candidate.enrollment.user_id }).order(:id).lock.pluck(:id)
      next if quiet_now?(metrics)

      now = @clock.call
      today = LearningCalendar.today(at: now)
      selected = select_daily(chosen, today)
      next [] if selected.empty?

      rows = selected.map do |candidate|
        { enrollment_id: candidate.enrollment.id, kind: candidate.kind, threshold: candidate.threshold, key: candidate.key,
          essential: candidate.essential, event_at: candidate.event_at, school_date: today, title: candidate.title,
          body: candidate.body, path: candidate.path, email_status: "pending", push_requested_at: now, created_at: now, updated_at: now }
      end
      next if quiet_now?(metrics)

      ids = LearnerNudge.insert_all(rows, unique_by: :index_learner_nudges_on_key, returning: %w[id key], record_timestamps: false).rows.to_h { |id, key| [ key, id ] }
      won = selected.filter_map { |candidate| [ candidate, ids[candidate.key] ] if ids[candidate.key] }
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
    metrics[:claimed] += claimed.size if claimed
    claimed
  end

  def deliver(claimed, metrics)
    metrics[:sent] += claimed.size
    claimed.each do |candidate, id, notification_id|
      break if quiet_now?(metrics)

      send_email(candidate, id, metrics)
      break if quiet_now?(metrics)

      push(id, notification_id)
    end
  end

  def send_email(candidate, id, metrics)
    user = candidate.enrollment.user
    status = if !NotificationEmailService.configured? then "not_configured"
    elsif user.email.blank? then "no_address"
    end
    pending = LearnerNudge.where(id: id, email_status: "pending")
    return pending.update_all(email_status: status) if status

    pace_email
    return if quiet_now?(metrics) || pending.update_all(email_status: "not_requested") != 1

    record = LearnerNudge.where(id: id)
    # Once a request starts, a crash leaves the claimed email non-retryable.
    # A request still unstarted at 21:00 can be evaluated again in the morning.
    return record.update_all(email_status: "pending") if quiet_now?(metrics)

    sent = NotificationEmailService.send_learner_nudge(user: user, cohort: candidate.enrollment.cohort,
      title: candidate.title, body: candidate.body, path: candidate.path, essential: candidate.essential)
    record.update_all(email_status: sent ? "sent" : "failed")
    metrics[:email_failed] += 1 unless sent
  end

  def pace_email
    wait = @last_email_at && email_interval - (monotonic - @last_email_at)
    sleep(wait) if wait&.positive?
    @last_email_at = monotonic
  end

  def push(nudge_id, notification_id)
    job = PushNotificationJob.new("LearnerNudge", nudge_id, [ notification_id ].compact)
    job.clock = @clock
    job.perform_now
  rescue StandardError => error
    # The outbox stays unsettled, so the next tick re-requests what wasn't claimed.
    @logger.error("[LearnerNudges] learner_nudge_id=#{nudge_id} push_failed=#{error.class}: #{error.message}")
  end

  def recover_deliveries(now, metrics)
    pending = LearnerNudge.push_pending.or(LearnerNudge.where(email_status: "pending"))
    due = pending.where(push_requested_at: ..(now - PUSH_GRACE)).order(:id).limit(@batch_size).to_a
    notifications = Notification.where(notifiable_type: "LearnerNudge", notifiable_id: due.map(&:id)).pluck(:notifiable_id, :id).to_h
    due.each do |nudge|
      break if quiet_now?(metrics) || monotonic - @started >= @time_budget

      if nudge.push_requested_at < now - PUSH_MAX_AGE
        metrics[:push_expired] += LearnerNudge.push_pending.where(id: nudge.id).update_all(push_settled_at: now)
        LearnerNudge.where(id: nudge.id, email_status: "pending").update_all(email_status: "not_requested")
        next
      end

      recover_email(nudge, metrics) if nudge.email_status == "pending"
      next if nudge.push_settled_at || quiet_now?(metrics)

      push(nudge.id, notifications[nudge.id])
      metrics[:push_requeued] += 1
    end
  end

  def recover_email(nudge, metrics)
    evaluate(nudge.enrollment_id, metrics) do
      candidate = current_candidate(nudge, now: @clock.call)
      if candidate
        send_email(candidate, nudge.id, metrics)
      else
        LearnerNudge.where(id: nudge.id, email_status: "pending").update_all(email_status: "not_requested")
      end
    end
  end

  def monotonic = Process.clock_gettime(Process::CLOCK_MONOTONIC)
end
