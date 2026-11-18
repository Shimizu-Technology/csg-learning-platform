# Request-local deadline inputs. It never loads submissions/progress or mutates
# Enrollment with hidden cache state. Lists preload once for every enrollment.
class SubmissionWindowContext
  PRELOAD = [ :learning_plan, :module_assignments, :lesson_assignments,
    { learner_extensions: :granted_by },
    { cohort: [ :cohort_module_schedules, :cohort_module_submission_windows, { curriculum: { modules: { lessons: :content_blocks } } } ] } ].freeze

  def self.for_all(enrollments)
    enrollments = enrollments.uniq(&:id)
    return {} if enrollments.empty?
    ActiveRecord::Associations::Preloader.new(records: enrollments, associations: PRELOAD).call
    school = FeatureSwitches.school
    enrollments.to_h { |item| [ item.id, new(item, school: school) ] }
  end

  attr_reader :enrollment

  def initialize(enrollment, content: nil, final_lesson: nil, school: nil)
    @enrollment = enrollment
    enrollment.cohort.cohort_module_submission_windows.load
    @content = content
    @final_lesson = final_lesson
    @final_loaded = !final_lesson.nil?
    @school = school
  end

  def lessons
    @lessons ||= begin
      content = @content || AssignedLearningContent.new(enrollment)
      content.modules.flat_map { |mod| content.lessons_for(mod) }
    end
  end

  def final_lesson
    return @final_lesson if @final_loaded

    plan = enrollment.learning_plan
    required_plan = plan if plan&.active? && FeatureSwitches.for(cohort: enrollment.cohort, school: @school)["learning_plans"]
    @final_lesson = lessons.reverse.find { |item| item.project? && (required_plan ? required_plan.required?(item) : item.required?) && item.completion_blocks.any? }
    @final_loaded = true
    @final_lesson
  end

  def base_close_at(lesson)
    cohort = enrollment.cohort
    plan = enrollment.learning_plan if cohort.personal_pace? && FeatureSwitches.for(cohort: cohort, school: @school)["learning_plans"]
    if plan&.active? && plan.learner_pace?
      # Weekly pace milestones never close submissions, even if a cohort
      # weekly close exists. Only the final project has a firm plan date.
      return nil unless lesson.project? && final_lesson&.id == lesson.id
      return plan.target_date&.in_time_zone("Pacific/Guam")&.end_of_day
    end
    cohort.submission_window_for(module_id: lesson.module_id,
      week_number: SubmissionWindowStatus.week_number_for_release_day(lesson.release_day))&.submissions_close_at
  end

  def matching_extensions(lesson, except_id: nil)
    enrollment.learner_extensions.reject { |item| !item.effective? || (except_id && item.id == except_id) }.select do |item|
      (item.scope == "lesson" && item.lesson_id == lesson.id) ||
        (item.scope == "module" && item.module_id == lesson.module_id && item.week_number == SubmissionWindowStatus.week_number_for_release_day(lesson.release_day)) ||
        (item.scope == "final" && lesson.project? && final_lesson&.id == lesson.id)
    end
  end

  def close_at(lesson, except_id: nil)
    base = base_close_at(lesson)
    return nil unless base # An unrestricted window is already unlimited time.

    [ base, *matching_extensions(lesson, except_id: except_id).map(&:submissions_close_at) ].max
  end
end
