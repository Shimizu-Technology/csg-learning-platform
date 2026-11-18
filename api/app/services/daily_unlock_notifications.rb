class DailyUnlockNotifications
  CATCH_UP_DAYS = 3
  class DeliveryFailed < StandardError; end

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
        result = NotificationEmailService.send_daily_unlock_for_enrollment(enrollment: enrollment, lessons: lessons, on: LearningCalendar.today(at: now))
        metrics[result ? :sent : :failed] += 1
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

  def candidates(now)
    today = LearningCalendar.today(at: now)
    first_date = today - (CATCH_UP_DAYS - 1)
    enrollments = Enrollment.active(at: now).joins(:cohort, :user)
      .merge(Cohort.active(on: today)).where(cohorts: { course_delivery: %w[program guided] })
      .where(users: { archived_at: nil }).includes(:user).to_a
    # Preview must not lazily create SchoolSetting through FeatureSwitches.school.
    school = FeatureSwitches.school(read_only: true)
    projections = LearnerProgress.for_all(enrollments, now: now, school_features: school)
    deliveries = enrollments.filter_map do |enrollment|
      progress = projections.fetch(enrollment.id)
      lessons = progress.lessons.select do |lesson|
        date = lesson.assigned_unlock_date(enrollment.cohort, progress.content.module_assignments[lesson.module_id], progress.content.lesson_assignments[lesson.id])
        date && date.between?(first_date, today) && (!progress.plan || progress.required?(lesson)) && progress.available?(lesson)
      end
      next if lessons.empty? || enrollment.user.email.blank? || enrollment.user.invite_pending?

      { enrollment: enrollment, lessons: lessons }
    end
    keys = deliveries.flat_map { |delivery| delivery[:lessons].map { |lesson| claim_key(delivery[:enrollment], lesson) } + [ digest_key(delivery[:enrollment], today) ] }
    claimed = ScheduledNotificationAttempt.where(key: keys).pluck(:key).to_set
    deliveries.each do |delivery|
      if claimed.include?(digest_key(delivery[:enrollment], today))
        delivery[:lessons].clear
      else
        delivery[:lessons].reject! { |lesson| claimed.include?(claim_key(delivery[:enrollment], lesson)) }
      end
    end
    deliveries.reject { |delivery| delivery[:lessons].empty? }
  end

  def digest_key(enrollment, today) = "daily_unlock_digest/#{enrollment.id}/#{today.iso8601}"

  def claim_key(enrollment, lesson) = "daily_unlock/#{enrollment.id}/#{lesson.id}"
end
