require_relative "../support/model_coverage"

class PrivateMeetingBookingEventTest < ModelCoverageTestCase
  test "event requires action actor and booking and preserves details" do
    row = PrivateMeetingBookingEvent.create!(private_meeting_booking: booking, actor: staff, action: "booked", details: { "week" => 1 })
    assert_equal({ "week" => 1 }, row.reload.details)
    assert_invalid row, :action, ""
    assert_invalid row, :actor, nil
    assert_invalid row, :private_meeting_booking, nil
  end
end
