require "test_helper"

class ReviewSlaTest < ActiveSupport::TestCase
  ZONE = Time.find_zone!(LearningCalendar::TIMEZONE)

  test "counts from the Guam calendar date through the end of the target day" do
    # Thursday in UTC, Friday in Guam. Monday is a school holiday.
    submitted_at = Time.utc(2026, 11, 19, 15)
    deadline = ZONE.local(2026, 11, 25).end_of_day
    sla = ReviewSla.new(holidays: [ Date.new(2026, 11, 23) ])

    assert_equal({
      business_days: 2, expected_on: "2026-11-25", expected_by: deadline.iso8601(6), overdue: false, overdue_days: 0
    }, sla.call(submitted_at: submitted_at, business_days: 2, now: deadline))
    assert_equal [ true, 1 ], sla.call(submitted_at: submitted_at, business_days: 2, now: deadline + 1.second).values_at(:overdue, :overdue_days)
  end

  test "weekend submissions start counting Monday and late weekend days do not count" do
    submitted_at = ZONE.local(2026, 11, 21, 18)
    sla = ReviewSla.new(holidays: [ Date.new(2026, 11, 30) ])

    keys = %i[expected_on overdue overdue_days]
    assert_equal [ "2026-11-27", true, 0 ], sla.call(submitted_at: submitted_at, business_days: 5, now: ZONE.local(2026, 11, 29, 10)).values_at(*keys)
    assert_equal [ "2026-11-27", true, 1 ], sla.call(submitted_at: submitted_at, business_days: 5, now: ZONE.local(2026, 12, 1, 10)).values_at(*keys)
  end

  test "the query cutoff matches the deadline across weekends and holidays" do
    sla = ReviewSla.new(holidays: [ Date.new(2026, 11, 23), Date.new(2026, 11, 25) ])
    [ ZONE.local(2026, 11, 25), ZONE.local(2026, 11, 26), ZONE.local(2026, 11, 29) ].each do |now|
      cutoff = sla.overdue_submitted_before(business_days: 2, now: now)
      assert sla.call(submitted_at: cutoff - 1.second, business_days: 2, now: now)[:overdue]
      assert_not sla.call(submitted_at: cutoff, business_days: 2, now: now)[:overdue]
    end
  end
end
