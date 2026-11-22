class CoursePurchase < ApplicationRecord
  PENDING_SEAT_HOLD_WINDOW = 24.hours

  belongs_to :user
  belongs_to :cohort
  # Admin alerts about this record (NotificationDeliveryService.admin_alert).
  has_many :notifications, as: :notifiable, dependent: :destroy

  # Pending checkouts hold a seat until their Stripe session expires (or up to
  # 24h while session creation is still in flight without a stored expiry).
  scope :holding_seat, ->(at: Time.current) {
    where(status: "pending").where(
      "(course_purchases.checkout_expires_at IS NOT NULL AND course_purchases.checkout_expires_at > :now) " \
      "OR (course_purchases.checkout_expires_at IS NULL AND course_purchases.updated_at > :cutoff)",
      now: at, cutoff: at - PENDING_SEAT_HOLD_WINDOW
    )
  }

  before_validation :snapshot_terms
  validates :access_months, :support_weeks, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true

  def snapshot_terms
    return unless cohort

    if cohort.guided?
      self.access_months ||= cohort.guided_access_months unless cohort.guided_access_ends_on.present?
      self.support_weeks ||= cohort.guided_support_weeks unless cohort.guided_support_ends_on.present?
    else
      self.access_months ||= cohort.self_paced_access_months
      self.support_weeks ||= cohort.self_paced_support_weeks
    end
  end

  # A request with no returned session is uncertain, never proof of non-payment.
  # Retrying within 23 hours leaves margin before Stripe can prune its key.
  def checkout_resumable?
    status == "pending" && stripe_session_id.blank? && checkout_attempt.present? &&
      Time.iso8601(checkout_attempt.fetch("requested_at")) > 23.hours.ago
  end

  def checkout_state
    return "setup_failed" if status == "failed" && stripe_session_id.blank?
    return "starting" if status == "pending" && stripe_session_id.blank?

    status
  end

  validates :status, inclusion: { in: %w[pending paid expired failed refunded disputed] }
  validates :stripe_price_id, presence: true
  validates :price_cents, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :user_id, uniqueness: { scope: :cohort_id }
end
