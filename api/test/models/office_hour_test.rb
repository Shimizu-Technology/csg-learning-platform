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
