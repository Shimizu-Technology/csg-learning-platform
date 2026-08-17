class DataDeletionRequest < ApplicationRecord
  enum :status, { pending: 0, processing: 1, completed: 2, declined: 3 }, prefix: true

  ALLOWED_STATUS_TRANSITIONS = {
    "pending" => %w[processing declined],
    "processing" => %w[completed declined]
  }.freeze

  belongs_to :user
  belongs_to :resolved_by, class_name: "User", optional: true

  validates :retention_note, length: { maximum: 2000 }
  validate :valid_status_transition, on: :update
  validate :resolution_note_present

  scope :recent_first, -> { order(created_at: :desc, id: :desc) }

  private

  def valid_status_transition
    return unless will_save_change_to_status?

    previous, next_status = status_change_to_be_saved
    return if ALLOWED_STATUS_TRANSITIONS.fetch(previous, []).include?(next_status)

    errors.add(:status, "cannot change from #{previous} to #{next_status}")
  end

  def resolution_note_present
    return unless status_completed? || status_declined?

    errors.add(:retention_note, "must document the completed deletion or reason for declining") if retention_note.blank?
  end
end
