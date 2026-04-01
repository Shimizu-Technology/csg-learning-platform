class ModuleAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :curriculum_module, foreign_key: :module_id

  validates :module_id, uniqueness: { scope: :enrollment_id }

  def available_for?(cohort)
    return false unless unlocked?
    return true if curriculum_module.lessons.empty?

    curriculum_module.lessons.any? { |lesson| lesson.available?(cohort, self) }
  end

  def next_unlock_date(cohort)
    return unlock_date_override if unlock_date_override.present?
    return nil if curriculum_module.lessons.empty?

    curriculum_module.lessons.map { |lesson| lesson.unlock_date(cohort) }.min
  end
end
