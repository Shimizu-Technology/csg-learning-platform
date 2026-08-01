require "test_helper"

class LearningCalendarTest < ActiveSupport::TestCase
  test "today changes at midnight in Guam instead of midnight UTC" do
    assert_equal Date.new(2026, 4, 5), LearningCalendar.today(at: Time.utc(2026, 4, 5, 13, 59))
    assert_equal Date.new(2026, 4, 6), LearningCalendar.today(at: Time.utc(2026, 4, 5, 14, 0))
  end
end
