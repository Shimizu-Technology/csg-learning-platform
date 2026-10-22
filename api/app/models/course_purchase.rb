class CoursePurchase < ApplicationRecord
  belongs_to :user
  belongs_to :cohort

  before_validation :snapshot_terms
  validates :access_months, :support_weeks, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true

  def snapshot_terms
    self.access_months ||= cohort.self_paced_access_months
    self.support_weeks ||= cohort.self_paced_support_weeks
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
