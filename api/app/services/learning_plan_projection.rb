# Student-safe projection. Staff-only edit history stays in the management endpoint.
# Completion, availability and the next step come from LearnerProgress.
class LearningPlanProjection
  def initialize(enrollment, progress: nil)
    @enrollment = enrollment
    # Only a plan the learner can see (active, with the learning_plans switch on).
    @progress = progress || (LearnerProgress.new(enrollment) if enrollment.learning_plan_enabled?)
    @plan = @progress&.plan
    @lessons = @progress&.lessons
  end

  def call
    return nil unless @plan

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
    next_lesson = @progress.next_lesson
    {
      title: @plan.title, description: @plan.description, target_date: @plan.target_date,
      next_check_in_on: @plan.next_check_in_on, updated_at: @plan.updated_at.iso8601(6),
      required_count: required.size, completed_count: required.count { |lesson| completed?(lesson) },
      awaiting_review_count: required.count { |lesson| @progress.lesson_progress(lesson).review_status == LessonReviewStatus::AWAITING_REVIEW },
      submission_deadlines: required.reject { |lesson| completed?(lesson) }.filter_map do |lesson|
        window = @progress.lesson_progress(lesson).submission_window
        next unless window[:submissions_close_at] || window[:submissions_closed]

        { lesson_id: lesson.id, title: lesson.title, available: available?(lesson), closes_at: window[:submissions_close_at], closed: window[:submissions_closed] }
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
    @progress.lesson_progress(lesson).completed
  end

  def available?(lesson)
    @progress.lesson_progress(lesson).available
  end

  def lesson_json(lesson)
    {
      lesson_id: lesson.id, module_id: lesson.module_id, title: lesson.title, required: @plan.required?(lesson),
      available: available?(lesson), completed: completed?(lesson), learner_status: @progress.lesson_progress(lesson).status,
      review_status: @progress.lesson_progress(lesson).review_status
    }
  end
end
