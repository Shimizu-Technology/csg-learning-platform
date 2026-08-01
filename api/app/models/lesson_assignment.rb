class LessonAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :lesson

  validates :lesson_id, uniqueness: { scope: :enrollment_id }

  def available?(cohort, module_assignment = nil, on: LearningCalendar.today)
    return on >= unlock_date_override if unlock_date_override.present?
    return unlocked? if has_attribute?(:unlocked)

    lesson.available?(cohort, module_assignment, on: on)
  end
end
