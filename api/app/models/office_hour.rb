require "uri"

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
  validate :meeting_url_is_http
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
    week_offset, current_start = next_weekly_start(from)
    limit.times do |index|
      occurrences << occurrence_for(current_start)
      current_start = weekly_start_at(week_offset + index + 1)
    end
    occurrences
  end

  private

  def next_weekly_start(from)
    zone = Time.find_zone!(timezone)
    anchor_local = starts_at.in_time_zone(zone)
    from_local = from.in_time_zone(zone)
    duration = duration_seconds.seconds
    week_offset = if anchor_local >= from_local
      0
    else
      [ ((from_local.to_date - anchor_local.to_date).to_i / 7).floor, 0 ].max
    end
    current_start = weekly_start_at(week_offset)

    while current_start + duration < from
      week_offset += 1
      current_start = weekly_start_at(week_offset)
    end

    [ week_offset, current_start ]
  end

  def weekly_start_at(week_offset)
    zone = Time.find_zone!(timezone)
    anchor_local = starts_at.in_time_zone(zone)
    occurrence_date = anchor_local.to_date + week_offset.weeks

    zone.local(
      occurrence_date.year,
      occurrence_date.month,
      occurrence_date.day,
      anchor_local.hour,
      anchor_local.min,
      anchor_local.sec
    )
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

  def meeting_url_is_http
    return if meeting_url.blank?

    uri = URI.parse(meeting_url)
    return if uri.is_a?(URI::HTTP) && uri.host.present?

    errors.add(:meeting_url, "must be a valid HTTP or HTTPS URL")
  rescue URI::InvalidURIError
    errors.add(:meeting_url, "must be a valid HTTP or HTTPS URL")
  end

  def timezone_is_valid
    return if timezone.blank?

    TZInfo::Timezone.get(timezone)
  rescue TZInfo::InvalidTimezoneIdentifier
    errors.add(:timezone, "is invalid")
  end
end
