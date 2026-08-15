class RecoveryPlan < ApplicationRecord
  enum :source, { restart: 0, extended_absence: 1, manual: 2 }, prefix: true
  enum :status, { active: 0, completed: 1, canceled: 2 }, prefix: true

  belongs_to :enrollment
  belongs_to :enrollment_restart, optional: true
  belongs_to :intervention, optional: true
  belongs_to :owner, class_name: "User"
  belongs_to :created_by, class_name: "User"
  has_many :check_ins, class_name: "RecoveryPlanCheckIn", dependent: :destroy

  scope :due, ->(at = Time.current) { status_active.where(next_check_in_at: ..at) }
  scope :recent_first, -> { order(created_at: :desc) }

  validates :source, :status, :target_pace, :required_scope, :check_in_cadence, :next_check_in_at, presence: true
  validates :target_pace, :check_in_cadence, length: { maximum: 200 }
  validates :required_scope, :optional_scope, :outcome, length: { maximum: 2_000 }, allow_blank: true
  validates :owner, :created_by, staff_role: true
  validates :outcome, :completed_at, presence: true, if: :status_completed?
  validate :relationships_match_enrollment

  before_validation :maintain_completion_state

  private

  def maintain_completion_state
    if status_completed?
      self.completed_at ||= Time.current
    elsif status_canceled?
      self.completed_at ||= Time.current
    else
      self.completed_at = nil
    end
  end

  def relationships_match_enrollment
    errors.add(:enrollment_restart, "must belong to the enrollment") if enrollment_restart && enrollment_restart.enrollment_id != enrollment_id
    errors.add(:intervention, "must belong to the enrollment") if intervention && intervention.enrollment_id != enrollment_id
  end
end
