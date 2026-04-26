class CohortModuleSchedule < ApplicationRecord
  belongs_to :cohort
  belongs_to :curriculum_module, foreign_key: :module_id

  validates :module_id, uniqueness: { scope: :cohort_id }
  validates :start_date, presence: true
  validate :start_date_matches_module_schedule

  private

  def start_date_matches_module_schedule
    return if start_date.blank? || curriculum_module.blank?

    expected_weekday_index = curriculum_module.first_scheduled_day_index
    actual_weekday_index = (start_date.wday + 6) % 7
    return if actual_weekday_index == expected_weekday_index

    errors.add(:start_date, "must fall on #{CurriculumModule::DAY_NAMES[expected_weekday_index]} for this module schedule")
  end
end
