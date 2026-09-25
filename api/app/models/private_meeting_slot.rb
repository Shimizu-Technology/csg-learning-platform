class PrivateMeetingSlot < ApplicationRecord
  belongs_to :private_meeting_config
  belongs_to :instructor, class_name: "User"
  has_many :private_meeting_bookings, dependent: :restrict_with_error

  scope :active, -> { where(active: true) }

  validates :starts_at, :ends_at, presence: true
  validate :valid_window

  def booked?
    private_meeting_bookings.confirmed.exists?
  end

  private

  def valid_window
    return unless starts_at && ends_at

    errors.add(:ends_at, "must be after start") unless ends_at > starts_at
    errors.add(:starts_at, "must be in the future") if new_record? && starts_at <= Time.current
    if private_meeting_config && (ends_at - starts_at) != private_meeting_config.duration_minutes.minutes
      errors.add(:ends_at, "must match the configured meeting duration")
    end
    if private_meeting_config && (
      private_meeting_config.week_for(starts_at).nil? ||
      private_meeting_config.week_for(ends_at - 1.second) != private_meeting_config.week_for(starts_at)
    )
      errors.add(:starts_at, "must fit within one course week")
    end
    errors.add(:instructor, "must match course instructor") if private_meeting_config && instructor_id != private_meeting_config.instructor_id
  end
end
