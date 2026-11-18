class SubmissionWindowStatus
  def self.for_lesson(cohort:, lesson:, enrollment: nil, at: Time.current)
    week_number = week_number_for_release_day(lesson.release_day)
    window = cohort.submission_window_for(module_id: lesson.module_id, week_number: week_number)
    status = build_status(week_number: week_number, window: window, at: at)
    return status unless enrollment

    extensions = enrollment.learner_extensions.to_a.reject(&:removed_at)
    matching = extensions.select do |item|
      (item.scope == "lesson" && item.lesson_id == lesson.id) ||
        (item.scope == "module" && item.module_id == lesson.module_id && item.week_number == week_number) ||
        (item.scope == "final" && final_lesson?(enrollment, lesson, require_pace: false))
    end
    # More than one grant may cover a lesson; the longest grant wins.
    extension = matching.max_by(&:submissions_close_at)
    close_at = extension&.submissions_close_at
    if !close_at && final_lesson?(enrollment, lesson)
      plan = enrollment.learning_plan
      close_at = plan.target_date.in_time_zone("Pacific/Guam").end_of_day if plan&.active? && plan.learner_pace? && plan.target_date
    end
    if !close_at && cohort.personal_pace? && enrollment.learning_plan&.active? && enrollment.learning_plan.learner_pace?
      return build_status(week_number: week_number, at: at) # weekly milestones are soft
    end
    return status unless close_at

    build_status(week_number: week_number, window: Struct.new(:submissions_close_at).new(close_at), at: at)
  end

  def self.final_lesson?(enrollment, lesson, require_pace: true)
    return false unless lesson.project?
    return false if require_pace && !enrollment.cohort.personal_pace?

    return enrollment.instance_variable_get(:@extension_final_lesson_id) == lesson.id if enrollment.instance_variable_defined?(:@extension_final_lesson_id)

    # Same required/assigned definition as LearnerPace, without status recursion.
    content = enrollment.instance_variable_get(:@extension_content) || AssignedLearningContent.new(enrollment)
    enrollment.instance_variable_set(:@extension_content, content)
    final = content.modules.flat_map { |mod| content.lessons_for(mod) }.reverse.find { |item| item.project? && enrollment.lesson_required?(item) && item.completion_blocks.any? }
    final&.id == lesson.id
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

  def self.closed_for_lesson?(cohort:, lesson:, enrollment: nil, at: Time.current)
    for_lesson(cohort: cohort, lesson: lesson, enrollment: enrollment, at: at)[:submissions_closed]
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
