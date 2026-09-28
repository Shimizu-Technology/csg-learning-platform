class CoursePurchase < ApplicationRecord
  belongs_to :user
  belongs_to :cohort

  validates :status, inclusion: { in: %w[pending paid expired failed refunded disputed] }
  validates :stripe_price_id, presence: true
  validates :price_cents, numericality: { only_integer: true, greater_than: 0 }, allow_nil: true
  validates :user_id, uniqueness: { scope: :cohort_id }
end
