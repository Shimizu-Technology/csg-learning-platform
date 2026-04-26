class CableTokenNonce < ApplicationRecord
  belongs_to :user

  validates :nonce, presence: true, uniqueness: true
  validates :expires_at, presence: true

  scope :active, -> { where(used_at: nil).where("expires_at > ?", Time.current) }
  scope :expired_or_used, -> { where.not(used_at: nil).or(where("expires_at <= ?", Time.current)) }
end
