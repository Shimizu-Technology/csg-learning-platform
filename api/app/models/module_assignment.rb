class ModuleAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :curriculum_module, foreign_key: :module_id

  validates :module_id, uniqueness: { scope: :enrollment_id }

  before_save :record_availability_change

  def record_availability_change
    self.availability_changed_at = Time.current if new_record? || will_save_change_to_unlocked? || will_save_change_to_unlock_date_override?
  end

  def effective_start_date(cohort = nil)
    return unlock_date_override if unlock_date_override.present?

    curriculum_module.start_date_for(cohort || enrollment.cohort)
  end

  # True if the module is accessible right now — either force-unlocked
  # or the date-based override has been reached.
  def accessible?(cohort = nil, on: LearningCalendar.today)
    return true if (cohort || enrollment.cohort).self_paced?
    return true if unlocked?

    start_date = effective_start_date(cohort)
    start_date.present? && on >= start_date
  end

  def available_for?(cohort)
    return false unless accessible?(cohort)
    return true if curriculum_module.lessons.empty?

    curriculum_module.lessons.any? { |lesson| lesson.available?(cohort, self) }
  end

  def next_unlock_date(cohort)
    return nil if curriculum_module.lessons.empty?

    curriculum_module.lessons.map { |lesson| lesson.unlock_date(cohort, self) }.min
  end
end
