class DailyUnlockNotifications
  class DeliveryFailed < StandardError; end

  def call(now: Time.current, last_date: nil)
    raise NotificationEmailService::ConfigurationError, "Daily unlock email is not configured" unless NotificationEmailService.configured?

    today = LearningCalendar.today(at: now)
    first_date = last_date ? last_date + 1 : today
    # Self-paced content is available on assignment, not by school-day release.
    # Paused/completed/dropped/expired enrollments receive no new-work nudges.
    enrollments = Enrollment.active.joins(:cohort, :user)
      .merge(Cohort.active).where(cohorts: { course_delivery: %w[program guided] })
      .where(users: { archived_at: nil }).includes(:user).to_a
    projections = LearnerProgress.for_all(enrollments, now: now)
    deliveries = enrollments.filter_map do |enrollment|
      progress = projections.fetch(enrollment.id)
      lessons = progress.lessons.select do |lesson|
        date = lesson.assigned_unlock_date(enrollment.cohort, progress.content.module_assignments[lesson.module_id], progress.content.lesson_assignments[lesson.id])
        date && date.between?(first_date, today) && progress.required?(lesson) && progress.available?(lesson)
      end
      next if lessons.empty? || enrollment.user.email.blank? || enrollment.user.invite_pending?

      { enrollment: enrollment, lessons: lessons }
    end
    return if deliveries.empty?

    # One bulk insert commits every claim before any provider call. Even an
    # uncertain provider response or a crash cannot cause a repeat tomorrow.
    claims = ScheduledNotificationAttempt.insert_all(
      deliveries.flat_map { |delivery| delivery[:lessons].map { |lesson| { key: claim_key(delivery[:enrollment], lesson), created_at: now } } },
      unique_by: :index_scheduled_notification_attempts_on_key, returning: %w[key]
    ).rows.flatten.to_set
    failed = false
    deliveries.each do |delivery|
      enrollment = delivery[:enrollment]
      lessons = delivery[:lessons].select { |lesson| claims.include?(claim_key(enrollment, lesson)) }
      next if lessons.empty?

      result = NotificationEmailService.send_daily_unlock_for_enrollment(enrollment: enrollment, lessons: lessons, on: today)
      failed = true unless result
    end
    raise DeliveryFailed, "Daily unlock email attempt failed; claims retained" if failed
  end

  private

  # Editing a release date is not permission to repeat a lesson email.
  def claim_key(enrollment, lesson) = "daily_unlock/#{enrollment.id}/#{lesson.id}"
end
