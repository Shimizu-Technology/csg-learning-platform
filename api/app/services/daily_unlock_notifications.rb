class DailyUnlockNotifications
  CATCH_UP_DAYS = 3
  DIGEST_KEY_PREFIX = "daily_unlock_digest".freeze
  LESSON_KEY_PREFIX = "daily_unlock".freeze
  class DeliveryFailed < StandardError; end

  def self.digest_key(enrollment_id, date)
    "#{DIGEST_KEY_PREFIX}/#{enrollment_id}/#{date.iso8601}"
  end

  def self.claim_key(enrollment_id, lesson_id)
    "#{LESSON_KEY_PREFIX}/#{enrollment_id}/#{lesson_id}"
  end

  def self.eligible_lessons_for_enrollment(enrollment, progress:, date_range:, on:, scheduled_at: nil)
    progress.lessons.select do |lesson|
      ma = progress.content.module_assignments[lesson.module_id]
      la = progress.content.lesson_assignments[lesson.id]
      date = lesson.assigned_unlock_date(enrollment.cohort, ma, la)
      next false unless date && date_range.cover?(date)
      next false if progress.plan && !progress.required?(lesson)
      next false if scheduled_at && enrollment.access_expires_at.present? && enrollment.access_expires_at <= scheduled_at

      on == progress.today ? progress.available?(lesson) : LessonReadAccess.readable?(enrollment, lesson, ma, la, on: on)
    end.uniq(&:id)
  end

  def candidates_for_enrollments(enrollments, now: Time.current, school: nil, projections: nil)
    today = LearningCalendar.today(at: now)
    first_date = today - (CATCH_UP_DAYS - 1)
    date_range = first_date..today
    enrollments = enrollments.to_a
    return [] if enrollments.empty?

    school ||= FeatureSwitches.school(read_only: true)
    projections ||= LearnerProgress.for_all(enrollments, now: now, school_features: school)
    deliveries = enrollments.filter_map do |enrollment|
      next if enrollment.user.nil? || enrollment.user.archived? || enrollment.user.email.blank? || enrollment.user.invite_pending?

      progress = projections.fetch(enrollment.id)
      lessons = self.class.eligible_lessons_for_enrollment(enrollment, progress: progress, date_range: date_range, on: today)
      next if lessons.empty?

      { enrollment: enrollment, lessons: lessons }
    end
    keys = deliveries.flat_map { |delivery| delivery[:lessons].map { |lesson| claim_key(delivery[:enrollment], lesson) } + [ digest_key(delivery[:enrollment], today) ] }
    claimed = keys.empty? ? Set.new : ScheduledNotificationAttempt.where(key: keys).pluck(:key).to_set
    deliveries.each do |delivery|
      if claimed.include?(digest_key(delivery[:enrollment], today))
        delivery[:lessons].clear
      else
        delivery[:lessons].reject! { |lesson| claimed.include?(claim_key(delivery[:enrollment], lesson)) }
      end
    end
    deliveries.reject { |delivery| delivery[:lessons].empty? }
  end

  def preview(now: Time.current, last_date: nil)
    deliveries = candidates(now)
    { recipients: deliveries.size, lessons: deliveries.sum { |delivery| delivery[:lessons].size },
      would_claim: deliveries.sum { |delivery| delivery[:lessons].size }, catch_up_days: CATCH_UP_DAYS }
  end

  def call(now: Time.current, last_date: nil, metrics: {})
    metrics.merge!(claimed: 0, sent: 0, failed: 0, catch_up_days: CATCH_UP_DAYS)
    raise NotificationEmailService::ConfigurationError, "Daily unlock email is not configured" unless NotificationEmailService.configured?

    deliveries = candidates(now)
    return if deliveries.empty?

    # Reserve a recipient/day and its lesson identities in one short primary
    # transaction. A partial task retry must not send newly released content to
    # somebody who already received (or ambiguously attempted) today's digest.
    today = LearningCalendar.today(at: now)
    claims = ScheduledNotificationAttempt.transaction do
      days = ScheduledNotificationAttempt.insert_all(
        deliveries.map { |delivery| { key: digest_key(delivery[:enrollment], today), created_at: now } },
        unique_by: :index_scheduled_notification_attempts_on_key, returning: %w[key]
      ).rows.flatten.to_set
      deliveries.select! { |delivery| days.include?(digest_key(delivery[:enrollment], today)) }
      next Set.new if deliveries.empty?

      ScheduledNotificationAttempt.insert_all(
        deliveries.flat_map { |delivery| delivery[:lessons].map { |lesson| { key: claim_key(delivery[:enrollment], lesson), created_at: now } } },
        unique_by: :index_scheduled_notification_attempts_on_key, returning: %w[key]
      ).rows.flatten.to_set
    end
    metrics[:claimed] = claims.size
    released = []
    released_lessons = 0
    deliveries.each do |delivery|
      enrollment = delivery[:enrollment]
      lessons = delivery[:lessons].select { |lesson| claims.include?(claim_key(enrollment, lesson)) }
      next if lessons.empty?

      begin
        result = NotificationEmailService.send_daily_unlock_for_enrollment(enrollment: enrollment, lessons: lessons, on: today)
        if result.nil?
          released.concat(lessons.map { |lesson| claim_key(enrollment, lesson) })
          released << digest_key(enrollment, today)
          released_lessons += lessons.size
        else
          metrics[result ? :sent : :failed] += 1
        end
      rescue NotificationEmailService::DailyUnlockRejected
        # A definite provider rejection never reached a learner. Release only
        # this invocation's claims, in one bulk statement after all recipients.
        released.concat(lessons.map { |lesson| claim_key(enrollment, lesson) })
        released << digest_key(enrollment, today)
        released_lessons += lessons.size
        metrics[:failed] += 1
      end
    end
    ScheduledNotificationAttempt.where(key: released).delete_all if released.any?
    metrics[:released] = released_lessons
    raise DeliveryFailed, "Daily unlock email attempt failed" if metrics[:failed].positive?
  end

  private

  # Personal-pace cohorts (W9.1) open everything at each learner's own start,
  # so there is no daily release to announce; their reminders come in W9.3.
  def candidates(now)
    today = LearningCalendar.today(at: now)
    enrollments = Enrollment.active(at: now).joins(:cohort, :user)
      .merge(Cohort.active(on: today)).where(cohorts: { course_delivery: %w[program guided], learner_pace_weeks: nil })
      .where(users: { archived_at: nil }).includes(:user).to_a
    # Preview must not lazily create SchoolSetting through FeatureSwitches.school.
    school = FeatureSwitches.school(read_only: true)
    candidates_for_enrollments(enrollments, now: now, school: school)
  end

  def digest_key(enrollment, today) = self.class.digest_key(enrollment.id, today)

  def claim_key(enrollment, lesson) = self.class.claim_key(enrollment.id, lesson.id)
end
