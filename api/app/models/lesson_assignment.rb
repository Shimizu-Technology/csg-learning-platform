class LessonAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :lesson

  validates :lesson_id, uniqueness: { scope: :enrollment_id }

  before_save :record_availability_change

  def record_availability_change
    self.availability_changed_at = Time.current if new_record? || will_save_change_to_unlocked? || will_save_change_to_unlock_date_override?
  end

  def available?(cohort, module_assignment = nil, on: LearningCalendar.today)
    return on >= unlock_date_override if unlock_date_override.present?
    return unlocked? if has_attribute?(:unlocked)

    lesson.available?(cohort, module_assignment, on: on)
  end
end
