class EnrollmentRestart < ApplicationRecord
  belongs_to :enrollment, optional: true
  belongs_to :student, class_name: "User"
  belongs_to :cohort
  belongs_to :performed_by, class_name: "User"

  validates :snapshot, :records_removed, presence: true

  has_one :recovery_plan, dependent: :nullify
end
