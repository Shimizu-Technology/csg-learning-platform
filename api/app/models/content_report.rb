class ContentReport < ApplicationRecord
  enum :reason, { harassment: 0, spam: 1, inappropriate_content: 2, safety_concern: 3, other: 4 }, prefix: true
  enum :status, { pending: 0, reviewing: 1, actioned: 2, dismissed: 3 }, prefix: true

  belongs_to :reporter, class_name: "User"
  belongs_to :reported_user, class_name: "User"
  belongs_to :message, optional: true
  belongs_to :reviewed_by, class_name: "User", optional: true

  validates :reason, presence: true
  validates :details, length: { maximum: 1000 }
  validate :reported_user_is_not_reporter
  validate :message_matches_reported_user

  scope :recent_first, -> { order(created_at: :desc, id: :desc) }

  private

  def reported_user_is_not_reporter
    errors.add(:reported_user, "cannot be yourself") if reporter_id.present? && reporter_id == reported_user_id
  end

  def message_matches_reported_user
    return if message.blank? || message.author_id == reported_user_id

    errors.add(:message, "does not belong to the reported user")
  end
end
