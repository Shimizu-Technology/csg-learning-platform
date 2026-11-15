require_relative "../support/model_coverage"

class PrivateMeetingSlotTest < ModelCoverageTestCase
  test "new slots require future matching duration instructor and single course week" do
    assert slot.persisted?
    assert_invalid slot.dup, :starts_at, Time.current
    assert_invalid slot, :ends_at, slot.starts_at
    assert_invalid slot, :ends_at, slot.ends_at + 1.minute
    assert_invalid slot, :instructor, person(:instructor)
    assert_database_rejects slot, { ends_at: slot.starts_at }
    crossing = slot.dup
    crossing.starts_at = Time.utc(2026, 4, 12, 13, 30)
    crossing.ends_at = crossing.starts_at + meeting_config.duration_minutes.minutes
    assert_not crossing.valid?
    assert crossing.errors[:starts_at].any?
    assert_includes PrivateMeetingSlot.active, slot
    slot.update!(active: false)
    assert_not PrivateMeetingSlot.active.exists?(slot.id)
  end

  test "confirmed bookings mark booked and restrict deletion even after cancellation" do
    booking
    assert slot.booked?
    assert_not slot.destroy
    booking.update!(status: :canceled)
    assert_not slot.booked?
    assert_not slot.destroy
  end
end
