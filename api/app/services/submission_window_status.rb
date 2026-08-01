class SubmissionWindowStatus
  def self.for_lesson(cohort:, lesson:, at: Time.current)
    week_number = week_number_for_release_day(lesson.release_day)
    window = cohort.submission_window_for(module_id: lesson.module_id, week_number: week_number)
    build_status(week_number: week_number, window: window, at: at)
  end

  def self.for_week(cohort:, curriculum_module:, week_number:, module_start_date: nil, at: Time.current)
    week_number = week_number.to_i
    window = cohort.submission_window_for(module_id: curriculum_module.id, week_number: week_number)
    status = build_status(week_number: week_number, window: window, at: at)
    starts_on = module_start_date.present? ? module_start_date + ((week_number - 1) * 7).days : nil

    status.merge(
      starts_on: starts_on,
      ends_on: starts_on.present? ? starts_on + 6.days : nil,
      lessons_count: lessons_count_for_week(curriculum_module, week_number)
    )
  end

  def self.closed_for_lesson?(cohort:, lesson:, at: Time.current)
    for_lesson(cohort: cohort, lesson: lesson, at: at)[:submissions_closed]
  end

  def self.week_number_for_release_day(release_day)
    (release_day.to_i / 7) + 1
  end

  def self.build_status(week_number:, window: nil, at: Time.current)
    close_at = window&.submissions_close_at
    closed = close_at.present? && close_at <= at
    status = if close_at.blank?
      "open"
    elsif closed
      "closed"
    else
      "scheduled"
    end

    {
      week_number: week_number,
      submissions_close_at: close_at,
      submissions_closed: closed,
      status: status
    }
  end
  private_class_method :build_status

  def self.lessons_count_for_week(curriculum_module, week_number)
    lower_bound = (week_number - 1) * 7
    upper_bound = lower_bound + 6

    if curriculum_module.lessons.loaded?
      curriculum_module.lessons.count { |lesson| lesson.release_day.between?(lower_bound, upper_bound) }
    else
      curriculum_module.lessons.where(release_day: lower_bound..upper_bound).count
    end
  end
  private_class_method :lessons_count_for_week
end
