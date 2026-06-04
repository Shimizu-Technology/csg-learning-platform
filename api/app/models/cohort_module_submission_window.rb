class CohortModuleSubmissionWindow < ApplicationRecord
  belongs_to :cohort
  belongs_to :curriculum_module, foreign_key: :module_id
  belongs_to :created_by, class_name: "User", optional: true
  belongs_to :updated_by, class_name: "User", optional: true

  validates :week_number, numericality: { only_integer: true, greater_than: 0 }
  validates :week_number, uniqueness: { scope: [ :cohort_id, :module_id ] }

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
end
