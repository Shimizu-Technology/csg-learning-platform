class LessonAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :lesson

  validates :lesson_id, uniqueness: { scope: :enrollment_id }

  def available?(cohort, module_assignment = nil)
    return Date.current >= unlock_date_override if unlock_date_override.present?
    return unlocked? if has_attribute?(:unlocked)

    lesson.available?(cohort, module_assignment)
  end
end
