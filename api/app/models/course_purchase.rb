class CoursePurchase < ApplicationRecord
  belongs_to :user
  belongs_to :cohort

  before_validation :snapshot_terms, on: :create
  validates :access_months, :support_weeks, numericality: { only_integer: true, greater_than: 0 }

  def snapshot_terms
    self.access_months ||= cohort.self_paced_access_months
    self.support_weeks ||= cohort.self_paced_support_weeks
  end

  validates :status, inclusion: { in: %w[pending paid expired failed refunded disputed] }
  validates :stripe_price_id, presence: true
  validates :price_cents, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :user_id, uniqueness: { scope: :cohort_id }
end
