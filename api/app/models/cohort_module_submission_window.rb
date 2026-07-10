class CohortModuleSubmissionWindow < ApplicationRecord
  belongs_to :cohort
  belongs_to :curriculum_module, foreign_key: :module_id
  belongs_to :created_by, class_name: "User", optional: true
  belongs_to :updated_by, class_name: "User", optional: true

  validates :week_number, numericality: { only_integer: true, greater_than: 0 }
  validates :week_number, uniqueness: { scope: [ :cohort_id, :module_id ] }
  validate :week_number_within_module
  validate :module_belongs_to_cohort_curriculum

  def closed?(at: Time.current)
    submissions_close_at.present? && submissions_close_at <= at
  end

  def scheduled?(at: Time.current)
    submissions_close_at.present? && submissions_close_at > at
  end

  def status(at: Time.current)
    return "open" if submissions_close_at.blank?

    closed?(at: at) ? "closed" : "scheduled"
  end

  private

  def week_number_within_module
    return if week_number.blank? || curriculum_module.blank?
    return if week_number <= curriculum_module.week_count

    errors.add(:week_number, "must be within this module's #{curriculum_module.week_count} week schedule")
  end

  def module_belongs_to_cohort_curriculum
    return if cohort.blank? || curriculum_module.blank?
    return if cohort.curriculum_id == curriculum_module.curriculum_id

    errors.add(:curriculum_module, "must belong to the cohort curriculum")
  end
end
