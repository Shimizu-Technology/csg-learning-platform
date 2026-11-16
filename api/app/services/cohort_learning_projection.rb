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
      entries = assigned.map { |enrollment| learners.fetch(enrollment.id).module_progress(mod) }
      completed = entries.sum(&:completed_blocks)
      total = entries.sum(&:total_blocks)
      lessons = assigned.map { |enrollment| learners.fetch(enrollment.id).module_lesson_counts(mod) }
      [ mod.id, {
        assigned_count: assigned.size,
        assigned_enrollment_ids: assigned.map(&:id),
        completed_lessons: lessons.sum { |counts| counts[:completed_lessons] },
        total_lessons: lessons.sum { |counts| counts[:total_lessons] },
        progress_percentage: total.positive? ? (completed.to_f / total * 100).round(1) : 0
      } ]
    end
  end
end
