require "test_helper"

class OfficeHourTest < ActiveSupport::TestCase
  def setup
    curriculum = Curriculum.create!(name: "Office Hours Curriculum")
    @cohort = Cohort.create!(
      curriculum: curriculum,
      name: "Office Hours Cohort",
      start_date: Date.new(2026, 1, 1),
      status: :active
    )
  end

  test "weekly occurrences preserve their wall-clock time across daylight saving changes" do
    zone = Time.find_zone!("America/Los_Angeles")
    starts_at = zone.local(2026, 3, 1, 18, 0, 0)
    office_hour = @cohort.office_hours.create!(
      title: "Weekly help",
      starts_at: starts_at,
      ends_at: starts_at + 1.hour,
      meeting_url: "https://meet.example.com/weekly",
      timezone: zone.tzinfo.name,
      recurrence: :weekly
    )

    occurrences = office_hour.upcoming_occurrences(limit: 2, from: starts_at - 1.minute)
    local_starts = occurrences.map { |occurrence| occurrence[:starts_at].in_time_zone(zone) }

    assert_equal [ 18, 18 ], local_starts.map(&:hour)
    assert_equal [ Date.new(2026, 3, 1), Date.new(2026, 3, 8) ], local_starts.map(&:to_date)
    assert_equal Time.utc(2026, 3, 9, 1), occurrences.second[:starts_at].utc
  end

  test "weekly occurrences use the anchor offset during a repeated fall-back hour" do
    zone = Time.find_zone!("America/New_York")
    starts_at = Time.iso8601("2026-11-01T01:30:00-05:00").in_time_zone(zone)
    office_hour = @cohort.office_hours.create!(
      title: "Fall-back help",
      starts_at: starts_at,
      ends_at: starts_at + 1.hour,
      meeting_url: "https://meet.example.com/fall-back",
      timezone: zone.tzinfo.name,
      recurrence: :weekly
    )

    occurrence = office_hour.upcoming_occurrences(limit: 1, from: starts_at - 1.minute).first

    assert_equal starts_at, occurrence[:starts_at]
    assert_equal(-5.hours, occurrence[:starts_at].utc_offset)
    refute occurrence[:starts_at].dst?
  end

  test "weekly occurrences choose the matching DST fold on a future fall-back date" do
    zone = Time.find_zone!("America/New_York")
    starts_at = zone.local(2026, 10, 25, 1, 30, 0)
    office_hour = @cohort.office_hours.create!(
      title: "Pre-fall-back help",
      starts_at: starts_at,
      ends_at: starts_at + 1.hour,
      meeting_url: "https://meet.example.com/pre-fall-back",
      timezone: zone.tzinfo.name,
      recurrence: :weekly
    )

    occurrences = office_hour.upcoming_occurrences(limit: 2, from: starts_at - 1.minute)
    fall_back_occurrence = occurrences.second[:starts_at]

    assert_equal Time.utc(2026, 11, 1, 5, 30), fall_back_occurrence.utc
    assert_equal(-4.hours, fall_back_occurrence.utc_offset)
    assert fall_back_occurrence.dst?
  end

  test "weekly occurrences advance through a nonexistent spring-forward hour" do
    zone = Time.find_zone!("America/New_York")
    starts_at = zone.local(2026, 3, 1, 2, 30, 0)
    office_hour = @cohort.office_hours.create!(
      title: "Pre-spring-forward help",
      starts_at: starts_at,
      ends_at: starts_at + 1.hour,
      meeting_url: "https://meet.example.com/pre-spring-forward",
      timezone: zone.tzinfo.name,
      recurrence: :weekly
    )

    occurrences = office_hour.upcoming_occurrences(limit: 2, from: starts_at - 1.minute)
    spring_forward_occurrence = occurrences.second[:starts_at]

    assert_equal Date.new(2026, 3, 8), spring_forward_occurrence.to_date
    assert_equal [ 3, 30 ], [ spring_forward_occurrence.hour, spring_forward_occurrence.min ]
    assert spring_forward_occurrence.dst?
  end

  test "past one-time sessions are not upcoming" do
    office_hour = @cohort.office_hours.create!(
      title: "Finished help",
      starts_at: 2.hours.ago,
      ends_at: 1.hour.ago,
      meeting_url: "https://meet.example.com/finished",
      timezone: "Pacific/Guam",
      recurrence: :once
    )

    assert_empty office_hour.upcoming_occurrences
  end

  test "meeting URL must use HTTP or HTTPS" do
    office_hour = @cohort.office_hours.new(
      title: "Unsafe help",
      starts_at: 1.day.from_now,
      ends_at: 1.day.from_now + 1.hour,
      meeting_url: "javascript:alert(1)",
      timezone: "Pacific/Guam",
      recurrence: :once
    )

    refute office_hour.valid?
    assert_includes office_hour.errors[:meeting_url], "must be a valid HTTP or HTTPS URL"
  end
end
