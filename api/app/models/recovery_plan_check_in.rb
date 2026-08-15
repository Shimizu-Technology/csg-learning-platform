class RecoveryPlanCheckIn < ApplicationRecord
  belongs_to :recovery_plan
  belongs_to :author, class_name: "User"

  validates :body, presence: true, length: { maximum: 4_000 }
  validates :author, staff_role: true
end
