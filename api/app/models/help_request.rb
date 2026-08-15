class HelpRequest < ApplicationRecord
  enum :context_type, { lesson: 0, exercise: 1, recording: 2 }, prefix: true
  enum :context_source, { primary: 0, legacy: 1 }, prefix: true
  enum :category, { concept: 0, technical: 1, instructions: 2, feedback: 3, other: 4 }, prefix: true
  enum :urgency, { normal: 0, urgent: 1 }, prefix: true
  enum :status, { open: 0, acknowledged: 1, resolved: 2, canceled: 3 }, prefix: true

  belongs_to :student, class_name: "User"
  belongs_to :cohort
  belongs_to :owner, class_name: "User", optional: true
  has_many :notifications, as: :notifiable, dependent: :destroy
  has_many :interventions, dependent: :nullify

  scope :active_queue, -> { where(status: %i[open acknowledged]) }
  scope :queue_order, -> { order(urgency: :desc, created_at: :asc) }
  scope :recent_first, -> { order(created_at: :desc) }

  validates :context_id, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :context_type, :context_source, :category, :urgency, :status, presence: true
  validates :context_label, presence: true, length: { maximum: 200 }
  validates :context_path, presence: true, length: { maximum: 500 }
  validates :message, presence: true, length: { maximum: 2_000 }
  validates :staff_response, length: { maximum: 2_000 }, allow_blank: true
  validates :owner, :acknowledged_at, presence: true, if: -> { status_acknowledged? || status_resolved? }
  validates :staff_response, :resolved_at, presence: true, if: :status_resolved?
  validates :canceled_at, presence: true, if: :status_canceled?
  validate :student_role
  validate :owner_role
  validate :student_belongs_to_cohort
  validate :legacy_only_for_recordings

  def acknowledge!(staff)
    with_lock do
      return false unless status_open?

      update!(status: :acknowledged, owner: staff, acknowledged_at: acknowledged_at || Time.current)
    end
    true
  end

  def resolve!(staff, response: nil)
    with_lock do
      return false unless status_open? || status_acknowledged?

      update!(
        status: :resolved,
        owner: staff,
        acknowledged_at: acknowledged_at || Time.current,
        resolved_at: Time.current,
        staff_response: response.to_s.strip
      )
    end
    true
  end

  def cancel!
    with_lock do
      return false unless status_open? || status_acknowledged?

      update!(status: :canceled, canceled_at: Time.current)
    end
    true
  end

  private

  def student_role
    errors.add(:student, "must be a student") if student && !student.student?
  end

  def owner_role
    errors.add(:owner, "must be staff") if owner && !owner.staff?
  end

  def student_belongs_to_cohort
    return unless student && cohort
    return if student.enrollments.where(cohort: cohort).exists?

    errors.add(:cohort, "must include the student")
  end

  def legacy_only_for_recordings
    return unless context_source_legacy? && !context_type_recording?

    errors.add(:context_source, "legacy is only valid for recordings")
  end
end
