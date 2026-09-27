class ActivityEvent < ApplicationRecord
  TYPES = %w[
    account_signed_in checkpoint_completed checkpoint_reopened
    video_started video_completed recording_started recording_completed
    submission_created submission_updated submission_graded
  ].freeze
  EVIDENCE = %w[server_record player_reported].freeze
  RECORD_TYPES = %w[ContentBlock Recording Submission].freeze

  belongs_to :actor, class_name: "User"
  belongs_to :subject_user, class_name: "User"
  belongs_to :cohort, optional: true

  validates :event_type, inclusion: { in: TYPES }
  validates :evidence, inclusion: { in: EVIDENCE }
  validates :record_type, inclusion: { in: RECORD_TYPES }, allow_nil: true
  validates :record_id, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validate :record_reference_is_complete

  scope :newest_first, -> { order(created_at: :desc, id: :desc) }

  def self.record!(event_type:, actor:, subject_user: actor, cohort: nil, record: nil, evidence: "server_record")
    create!(
      event_type: event_type,
      actor: actor,
      subject_user: subject_user,
      cohort: cohort,
      record_type: record&.class&.name,
      record_id: record&.id,
      evidence: evidence
    )
  end

  private

  def record_reference_is_complete
    errors.add(:record_type, "and record ID must be set together") if record_type.present? != record_id.present?
  end
end
