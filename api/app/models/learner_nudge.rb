# One reminder sent to a learner (W9.3, AS-4). LearnerNudges decides what is
# due and creates these; the unique `key` names the learner, the event (with
# its effective date) and the threshold, so a rerun or an overlapping tick can
# never send the same reminder twice. The row is the notifiable of the
# learner's in-app notification and carries the push outbox columns that
# PushNotificationJob claims per provider, as announcements do.
class LearnerNudge < ApplicationRecord
  KINDS = %w[due_soon inactive support_ending access_ending].freeze
  EMAIL_STATUSES = %w[not_requested pending sent failed not_configured no_address].freeze

  belongs_to :enrollment
  has_many :notifications, as: :notifiable, dependent: :delete_all

  validates :kind, inclusion: { in: KINDS }
  validates :email_status, inclusion: { in: EMAIL_STATUSES }
  validates :key, :threshold, :title, :path, :event_at, :school_date, presence: true

  scope :push_pending, -> { where.not(push_requested_at: nil).where(push_settled_at: nil) }

  # Provider claims record attempts, regardless of device delivery.
  def push_status
    return "not_requested" unless push_requested_at
    return "pending" unless push_settled_at

    attempts = [ web_push_attempted_notification_ids, expo_push_attempted_notification_ids ].count(&:present?)
    %w[not_sent partial attempted].fetch(attempts)
  end

  def staff_json(notification = nil)
    {
      id: id,
      kind: kind,
      threshold: threshold,
      essential: essential,
      title: title,
      body: body,
      event_at: event_at.iso8601,
      sent_at: created_at.iso8601,
      email_status: email_status,
      push_status: push_status,
      read_at: notification&.read_at&.iso8601
    }
  end
end
