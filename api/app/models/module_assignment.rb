class ModuleAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :curriculum_module, foreign_key: :module_id

  validates :module_id, uniqueness: { scope: :enrollment_id }

  before_save :record_availability_change

  def record_availability_change
    if new_record?
      self.availability_changed_at = Time.current
    elsif will_save_change_to_unlocked? || will_save_change_to_unlock_date_override?
      previous = dup
      previous.assign_attributes(unlocked: unlocked_in_database, unlock_date_override: unlock_date_override_in_database)
      # A date edit can release a later lesson even when the module is already open.
      dates = [ LearningCalendar.today, enrollment.read_cutoff_date ].compact.uniq
      newly_available = dates.any? do |date|
        (accessible?(on: date) && !previous.accessible?(on: date)) || curriculum_module.lessons.any? do |lesson|
          lesson.available?(enrollment.cohort, self, on: date) && !lesson.available?(enrollment.cohort, previous, on: date)
        end
      end
      self.availability_changed_at = newly_available ? Time.current : (availability_changed_at || updated_at_in_database)
    end
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
