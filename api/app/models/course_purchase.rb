class CoursePurchase < ApplicationRecord
  PENDING_SEAT_HOLD_WINDOW = 24.hours
  OPEN_ATTEMPT_STATUSES = %w[pending failed expired].freeze

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

  def self.terms_snapshot_for(cohort)
    return {} unless cohort

    {
      "course_delivery" => cohort.course_delivery,
      "cohort_type" => cohort.cohort_type,
      "access_months" => cohort.guided? ? (cohort.guided_access_ends_on.present? ? nil : cohort.guided_access_months) : cohort.self_paced_access_months,
      "support_weeks" => cohort.guided? ? (cohort.guided_support_ends_on.present? ? nil : cohort.guided_support_weeks) : cohort.self_paced_support_weeks,
      "guided_access_ends_on" => cohort.guided? ? cohort.guided_access_ends_on&.iso8601 : nil,
      "guided_support_ends_on" => cohort.guided? ? cohort.guided_support_ends_on&.iso8601 : nil,
      "guided_access_ends_at" => cohort.guided? ? cohort.guided_access_ends_at&.iso8601 : nil,
      "guided_support_ends_at" => cohort.guided? ? cohort.guided_support_ends_at&.iso8601 : nil,
      "guided_access_months" => cohort.guided? ? cohort.guided_access_months : nil,
      "guided_support_weeks" => cohort.guided? ? cohort.guided_support_weeks : nil
    }
  end

  def snapshot_terms
    return unless cohort

    caught_up_access = access_months.nil?
    caught_up_support = support_weeks.nil?
    if cohort.guided?
      self.access_months ||= cohort.guided_access_months unless cohort.guided_access_ends_on.present?
      self.support_weeks ||= cohort.guided_support_weeks unless cohort.guided_support_ends_on.present?
    else
      self.access_months ||= cohort.self_paced_access_months
      self.support_weeks ||= cohort.self_paced_support_weeks
    end
    if terms_snapshot.blank?
      snap = self.class.terms_snapshot_for(cohort)
      # Preserve terms already saved on pre-upgrade purchases even if staff later
      # edited the cohort's current defaults.
      snap["access_months"] = access_months if access_months.present?
      snap["support_weeks"] = support_weeks if support_weeks.present?
      if cohort.guided?
        snap["guided_access_months"] = access_months if access_months.present? && snap["guided_access_ends_on"].blank?
        snap["guided_support_weeks"] = support_weeks if support_weeks.present? && snap["guided_support_ends_on"].blank?
      end
      self.terms_snapshot = snap
    elsif !cohort.guided? && (caught_up_access || caught_up_support)
      snap = terms_snapshot.dup
      snap["access_months"] = access_months if caught_up_access
      snap["support_weeks"] = support_weeks if caught_up_support
      self.terms_snapshot = snap
    end
  end

  def sold_terms
    snap = terms_snapshot.is_a?(Hash) ? terms_snapshot : {}
    if snap.key?("course_delivery")
      {
        course_delivery: snap["course_delivery"],
        cohort_type: snap["cohort_type"],
        access_months: snap["course_delivery"] == "guided" ? snap["access_months"] : (access_months || snap["access_months"]),
        support_weeks: snap["course_delivery"] == "guided" ? snap["support_weeks"] : (support_weeks || snap["support_weeks"]),
        guided_access_ends_on: parse_snapshot_date(snap["guided_access_ends_on"]),
        guided_support_ends_on: parse_snapshot_date(snap["guided_support_ends_on"]),
        guided_access_ends_at: parse_snapshot_time(snap["guided_access_ends_at"]),
        guided_support_ends_at: parse_snapshot_time(snap["guided_support_ends_at"]),
        guided_access_months: snap["guided_access_months"],
        guided_support_weeks: snap["guided_support_weeks"]
      }
    else
      {
        course_delivery: cohort&.course_delivery,
        cohort_type: cohort&.cohort_type,
        access_months: access_months || (cohort&.guided? ? (cohort.guided_access_ends_on.present? ? nil : cohort.guided_access_months) : cohort&.self_paced_access_months),
        support_weeks: support_weeks || (cohort&.guided? ? (cohort.guided_support_ends_on.present? ? nil : cohort.guided_support_weeks) : cohort&.self_paced_support_weeks),
        guided_access_ends_on: cohort&.guided? ? cohort.guided_access_ends_on : nil,
        guided_support_ends_on: cohort&.guided? ? cohort.guided_support_ends_on : nil,
        guided_access_ends_at: cohort&.guided? ? cohort.guided_access_ends_at : nil,
        guided_support_ends_at: cohort&.guided? ? cohort.guided_support_ends_at : nil,
        guided_access_months: cohort&.guided? ? (access_months || cohort.guided_access_months) : nil,
        guided_support_weeks: cohort&.guided? ? (support_weeks || cohort.guided_support_weeks) : nil
      }
    end
  end

  def sold_course_delivery
    sold_terms[:course_delivery]
  end

  def sold_eligible_for_checkout?
    terms = sold_terms
    Cohort::CHECKOUT_DELIVERIES.include?(terms[:course_delivery]) && terms[:cohort_type] != "alumni"
  end

  def fulfilled_after_access_end?
    ActiveModel::Type::Boolean.new.cast(terms_snapshot&.[]("fulfilled_after_access_end")) == true
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
  validates :user_id,
    uniqueness: { scope: :cohort_id, conditions: -> { where(status: OPEN_ATTEMPT_STATUSES) } },
    if: -> { OPEN_ATTEMPT_STATUSES.include?(status) }

  private

  def parse_snapshot_date(value)
    return nil if value.blank?

    Date.iso8601(value.to_s)
  rescue ArgumentError
    nil
  end

  def parse_snapshot_time(value)
    return nil if value.blank?

    Time.iso8601(value.to_s)
  rescue ArgumentError
    nil
  end
end
