class MobilePushToken < ApplicationRecord
  belongs_to :user

  PLATFORMS = %w[ios android].freeze

  validates :token, presence: true, uniqueness: true,
    format: { with: /\AExpo(?:nent)?PushToken\[[^\]]+\]\z/, message: "must be an Expo push token" }
  validates :platform, inclusion: { in: PLATFORMS }
  validates :last_seen_at, presence: true

  scope :active, -> { where(failed_at: nil) }

  def mark_seen!
    update!(last_seen_at: Time.current, failed_at: nil)
  end

  def mark_failed!
    update!(failed_at: Time.current)
  end
end
