class ModuleAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :curriculum_module, foreign_key: :module_id

  validates :module_id, uniqueness: { scope: :enrollment_id }

  # True if the module is accessible right now — either force-unlocked
  # or the date-based override has been reached.
  def accessible?
    return true if unlocked?

    unlock_date_override.present? && Date.current >= unlock_date_override
  end

  def available_for?(cohort)
    return false unless accessible?
    return true if curriculum_module.lessons.empty?

    curriculum_module.lessons.any? { |lesson| lesson.available?(cohort, self) }
  end

  def next_unlock_date(cohort)
    return nil if curriculum_module.lessons.empty?

    curriculum_module.lessons.map { |lesson| lesson.unlock_date(cohort, self) }.min
  end
end
