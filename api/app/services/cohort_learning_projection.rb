# Module-card counts use the same assigned lessons and credit as each learner.
# Batch loading keeps query counts flat across learners and modules.
class CohortLearningProjection
  def initialize(cohort:)
    @cohort = cohort
  end

  def call
    enrollments = @cohort.enrollments.active.joins(:user).merge(User.not_archived).to_a
    learners = LearnerProgress.for_all(enrollments)
    @cohort.curriculum.modules.to_h do |mod|
      assigned = enrollments.select { |enrollment| learners.fetch(enrollment.id).content.modules.any? { |item| item.id == mod.id } }
      lessons = assigned.map { |enrollment| learners.fetch(enrollment.id).module_lesson_counts(mod) }
      completed = lessons.sum { |counts| counts[:completed_lessons] }
      total = lessons.sum { |counts| counts[:total_lessons] }
      [ mod.id, {
        assigned_count: assigned.size,
        assigned_enrollment_ids: assigned.map(&:id),
        completed_lessons: completed,
        total_lessons: total,
        progress_percentage: total.positive? ? (completed.to_f / total * 100).round(1) : 0
      } ]
    end
  end
end
