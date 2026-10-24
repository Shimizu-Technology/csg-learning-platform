# Student-safe projection. Staff-only edit history stays in the management endpoint.
class LearningPlanProjection
  def initialize(enrollment)
    @enrollment = enrollment
    @content = AssignedLearningContent.new(enrollment)
    @plan = enrollment.learning_plan
    enrollment.cohort.cohort_module_submission_windows.load if @plan&.active?
    @lessons = @content.modules.flat_map { |mod| @content.lessons_for(mod) }
    @completed = enrollment.progresses.completed.pluck(:content_block_id).to_set
    @submissions = enrollment.submissions.where(id: enrollment.submissions.group(:content_block_id).select("MAX(id)"))
      .index_by(&:content_block_id)
  end

  def call
    return nil unless @plan&.active?

    required = @lessons.select { |lesson| @plan.required?(lesson) }
    milestones = @plan.milestones.map do |item|
      lessons = item["lesson_ids"].filter_map { |id| @lessons.find { |lesson| lesson.id == id } }
      required_lessons = lessons.select { |lesson| @plan.required?(lesson) }
      item.slice("title", "due_on").merge(
        lessons: lessons.map { |lesson| lesson_json(lesson) },
        completed_count: required_lessons.count { |lesson| completed?(lesson) },
        required_count: required_lessons.size
      )
    end
    ordered_ids = @plan.milestones.flat_map { |item| item["lesson_ids"] }
    next_lesson = required.sort_by { |lesson| ordered_ids.index(lesson.id) || ordered_ids.size }
      .find { |lesson| !completed?(lesson) && available?(lesson) }
    {
      title: @plan.title, description: @plan.description, target_date: @plan.target_date,
      next_check_in_on: @plan.next_check_in_on, updated_at: @plan.updated_at.iso8601(6),
      required_count: required.size, completed_count: required.count { |lesson| completed?(lesson) },
      awaiting_review_count: required.count { |lesson| LessonReviewStatus.for(lesson, @submissions) == "awaiting_review" },
      submission_deadlines: required.reject { |lesson| completed?(lesson) }.filter_map do |lesson|
        window = SubmissionWindowStatus.for_lesson(cohort: @enrollment.cohort, lesson: lesson)
        next unless window[:submissions_close_at] || window[:submissions_closed]

        { lesson_id: lesson.id, title: lesson.title, closes_at: window[:submissions_close_at], closed: window[:submissions_closed] }
      end,
      milestones: milestones, next_lesson: next_lesson && lesson_json(next_lesson),
      requirement_changes: @plan.lesson_overrides.filter_map do |item|
        lesson = @lessons.find { |candidate| candidate.id == item["lesson_id"] }
        next unless lesson

        { lesson_id: lesson.id, title: lesson.title, required: item["required"], reason: item["reason"] }
      end
    }
  end

  private

  def completed?(lesson)
    return false if LessonReviewStatus.for(lesson, @submissions) == "redo_requested"

    ids = lesson.completion_block_ids
    ids.any? && ids.all? { |id| @completed.include?(id) }
  end

  def available?(lesson)
    lesson.available?(@enrollment.cohort, @content.module_assignments[lesson.module_id], @content.lesson_assignments[lesson.id])
  end

  def lesson_json(lesson)
    {
      lesson_id: lesson.id, module_id: lesson.module_id, title: lesson.title, required: @plan.required?(lesson),
      available: available?(lesson), completed: completed?(lesson), review_status: LessonReviewStatus.for(lesson, @submissions)
    }
  end
end
