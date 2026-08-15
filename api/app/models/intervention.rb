class Intervention < ApplicationRecord
  enum :trigger_type, { manual: 0, help_request: 1, redo: 2, ungraded: 3, inactivity: 4, restart: 5, extended_absence: 6 }, prefix: true
  enum :severity, { normal: 0, urgent: 1 }, prefix: true
  enum :status, { open: 0, contacted: 1, waiting_on_student: 2, monitoring: 3, resolved: 4, canceled: 5 }, prefix: true
  enum :outcome, { re_engaged: 0, plan_completed: 1, support_resolved: 2, referred: 3, paused: 4, withdrawn: 5, no_change: 6 }, prefix: true

  belongs_to :enrollment
  belongs_to :help_request, optional: true
  belongs_to :owner, class_name: "User"
  belongs_to :created_by, class_name: "User"
  has_many :notes, class_name: "InterventionNote", dependent: :destroy
  has_one :recovery_plan, dependent: :nullify
  has_many :notifications, as: :notifiable, dependent: :destroy

  scope :active, -> { where(status: %i[open contacted waiting_on_student monitoring]) }
  scope :due, ->(at = Time.current) { active.where.not(next_follow_up_at: nil).where(next_follow_up_at: ..at) }
  scope :recent_first, -> { order(created_at: :desc) }

  validates :trigger_type, :severity, :status, presence: true
  validates :action_summary, :resolution_summary, length: { maximum: 2_000 }, allow_blank: true
  validates :owner, :created_by, staff_role: true
  validates :outcome, :resolved_at, presence: true, if: :status_resolved?
  validates :next_follow_up_at, presence: true, if: :active?
  validate :enrollment_matches_help_request
  validate :evidence_snapshot_is_object

  before_validation :maintain_resolution_state
  before_save :clear_follow_up_notification, if: :will_save_change_to_next_follow_up_at?

  def active?
    status_open? || status_contacted? || status_waiting_on_student? || status_monitoring?
  end

  private

  def maintain_resolution_state
    if status_resolved?
      self.resolved_at ||= Time.current
    elsif status_canceled?
      self.resolved_at ||= Time.current
      self.outcome = nil
    else
      self.resolved_at = nil
      self.outcome = nil if outcome.present?
    end
  end

  def clear_follow_up_notification
    self.follow_up_notified_at = nil
  end

  def enrollment_matches_help_request
    return unless help_request && enrollment
    return if help_request.student_id == enrollment.user_id && help_request.cohort_id == enrollment.cohort_id

    errors.add(:help_request, "must belong to the intervention enrollment")
  end

  def evidence_snapshot_is_object
    errors.add(:evidence_snapshot, "must be an object") unless evidence_snapshot.is_a?(Hash)
  end
end
