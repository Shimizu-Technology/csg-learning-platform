class ClerkIdentity < ApplicationRecord
  belongs_to :user

  validates :issuer, presence: true
  validates :clerk_user_id, presence: true
  validates :clerk_user_id, uniqueness: { scope: :issuer }
  validates :issuer, uniqueness: { scope: :user_id }

  scope :for_issuer, ->(issuer) { where(issuer: issuer) }

  def touch_last_seen!
    return if last_seen_at.present? && last_seen_at > 15.minutes.ago

    update_column(:last_seen_at, Time.current)
  end
end
