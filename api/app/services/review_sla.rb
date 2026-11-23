# Deadlines use school calendar dates. The submission day never counts, and
# feedback is on time through the end of the Nth eligible weekday.
class ReviewSla
  def initialize(holidays:)
    @holidays = holidays.to_set
  end

  def call(submitted_at:, business_days:, now: Time.current)
    submitted_on = submitted_at.in_time_zone(LearningCalendar::TIMEZONE).to_date
    expected_on = advance(submitted_on, business_days)
    expected_by = expected_on.in_time_zone(LearningCalendar::TIMEZONE).end_of_day
    overdue = now > expected_by
    today = now.in_time_zone(LearningCalendar::TIMEZONE).to_date
    {
      business_days: business_days,
      expected_on: expected_on.iso8601,
      expected_by: expected_by.iso8601(6),
      overdue: overdue,
      overdue_days: overdue ? (expected_on.next_day..today).count { |date| business_day?(date) } : 0
    }
  end

  # Any submission before this school-local midnight is past the target. This lets
  # the grading queue count overdue rows in SQL across all its pages.
  def overdue_submitted_before(business_days:, now:)
    today = now.in_time_zone(LearningCalendar::TIMEZONE).to_date
    advance(today, -business_days).in_time_zone(LearningCalendar::TIMEZONE)
  end

  private

  def advance(date, days)
    step = days <=> 0
    remaining = days.abs
    until remaining.zero?
      date += step
      remaining -= 1 if business_day?(date)
    end
    date
  end

  def business_day?(date)
    (1..5).cover?(date.wday) && !@holidays.include?(date)
  end
end
