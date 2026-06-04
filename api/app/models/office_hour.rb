class OfficeHour < ApplicationRecord
  DEFAULT_TIMEZONE = "Pacific/Guam".freeze

  enum :recurrence, { once: 0, weekly: 1 }, prefix: true

  belongs_to :cohort
  belongs_to :created_by, class_name: "User", optional: true

  scope :active, -> { where(active: true) }
  scope :ordered, -> { order(:starts_at) }

  validates :title, presence: true
  validates :starts_at, presence: true
  validates :ends_at, presence: true
  validates :meeting_url, presence: true
  validates :timezone, presence: true
  validate :ends_after_starts
  validate :timezone_is_valid

  before_validation :set_default_timezone

  def duration_seconds
    return 0 unless starts_at && ends_at

    [ ends_at - starts_at, 0 ].max
  end

  def upcoming_occurrences(limit: 3, from: Time.current)
    return [] unless active?
    return [] unless starts_at && ends_at

    if recurrence_once?
      return [] if ends_at < from

      return [ occurrence_for(starts_at) ].first(limit)
    end

    occurrences = []
    current_start = next_weekly_start(from)
    limit.times do
      occurrences << occurrence_for(current_start)
      current_start += 1.week
    end
    occurrences
  end

  private

  def next_weekly_start(from)
    current_start = starts_at
    duration = duration_seconds.seconds

    if current_start < from
      elapsed_weeks = [ ((from - current_start) / 1.week).floor, 0 ].max
      current_start += elapsed_weeks.weeks
      current_start += 1.week while current_start + duration < from
    end

    current_start
  end

  def occurrence_for(start_time)
    {
      starts_at: start_time,
      ends_at: start_time + duration_seconds.seconds
    }
  end

  def set_default_timezone
    self.timezone = DEFAULT_TIMEZONE if timezone.blank?
  end

  def ends_after_starts
    return if starts_at.blank? || ends_at.blank?
    return if ends_at > starts_at

    errors.add(:ends_at, "must be after the start time")
  end

  def timezone_is_valid
    return if timezone.blank?

    TZInfo::Timezone.get(timezone)
  rescue TZInfo::InvalidTimezoneIdentifier
    errors.add(:timezone, "is invalid")
  end
end
