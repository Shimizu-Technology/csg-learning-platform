class PushSubscription < ApplicationRecord
  belongs_to :user

  validates :endpoint, presence: true, uniqueness: true
  validates :p256dh, presence: true
  validates :auth, presence: true

  scope :active, -> { where(failed_at: nil) }

  def mark_seen!
    update!(last_seen_at: Time.current, failed_at: nil)
  end

  def mark_failed!
    update!(failed_at: Time.current)
  end
end
