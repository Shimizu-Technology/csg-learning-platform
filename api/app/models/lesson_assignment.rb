class LessonAssignment < ApplicationRecord
  belongs_to :enrollment
  belongs_to :lesson

  validates :lesson_id, uniqueness: { scope: :enrollment_id }

  before_save :record_availability_change

  def record_availability_change
    if new_record?
      self.availability_changed_at = Time.current
    elsif will_save_change_to_unlocked? || will_save_change_to_unlock_date_override?
      previous = dup
      previous.assign_attributes(unlocked: unlocked_in_database, unlock_date_override: unlock_date_override_in_database)
      dates = [ LearningCalendar.today, enrollment.read_cutoff_date ].compact.uniq
      newly_available = dates.any? do |date|
        available?(enrollment.cohort, on: date) && !previous.available?(enrollment.cohort, on: date)
      end
      self.availability_changed_at = newly_available ? Time.current : (availability_changed_at || updated_at_in_database)
    end
  end

  def available?(cohort, module_assignment = nil, on: LearningCalendar.today)
    return on >= unlock_date_override if unlock_date_override.present?
    return unlocked? if has_attribute?(:unlocked)

    lesson.available?(cohort, module_assignment, on: on)
  end
end
