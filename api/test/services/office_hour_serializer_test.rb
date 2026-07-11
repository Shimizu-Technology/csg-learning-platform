require "test_helper"

class OfficeHourSerializerTest < ActiveSupport::TestCase
  test "collection serialization expands each office hour only once" do
    starts_at = Time.utc(2030, 7, 10, 8)
    office_hour = Struct.new(
      :id,
      :cohort_id,
      :title,
      :description,
      :starts_at,
      :ends_at,
      :meeting_url,
      :timezone,
      :recurrence,
      :active,
      :created_by,
      keyword_init: true
    ).new(
      id: 42,
      cohort_id: 7,
      title: "Weekly help",
      starts_at: starts_at,
      ends_at: starts_at + 1.hour,
      meeting_url: "https://meet.example.com/weekly",
      timezone: "Pacific/Guam",
      recurrence: "weekly",
      active: true
    )
    occurrences = 4.times.map do |week|
      occurrence_start = starts_at + week.weeks
      { starts_at: occurrence_start, ends_at: occurrence_start + 1.hour }
    end
    expansion_limits = []
    office_hour.define_singleton_method(:upcoming_occurrences) do |limit:|
      expansion_limits << limit
      occurrences.first(limit)
    end

    payload = OfficeHourSerializer.collection_json(
      [ office_hour ],
      occurrence_limit: 2,
      upcoming_limit: 4
    )

    assert_equal [ 4 ], expansion_limits
    assert_equal 2, payload[:office_hours].first[:occurrences].length
    assert_equal 4, payload[:upcoming].length
  end
end
