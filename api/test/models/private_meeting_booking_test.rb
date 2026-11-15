require_relative "../support/model_coverage"

class PrivateMeetingBookingTest < ModelCoverageTestCase
  test "database enforces positive range week count and confirmed slot and enrollment uniqueness" do
    booking
    assert_invalid booking, :zoom_url, "http://example.com/meeting"
    booking.update!(zoom_url: "https://example.com/meeting")
    assert_database_rejects booking, { ends_at: booking.starts_at }
    assert_database_rejects booking, { week_number: 0 }
    assert_database_rejects booking, { student_change_count: -1 }
    other = booking.dup
    other.status = :canceled
    other.starts_at += 3.hours
    other.ends_at += 3.hours
    other.save!
    assert_database_rejects other, { status: :confirmed }, ActiveRecord::RecordNotUnique
    booking.update!(status: :canceled)
    other.update!(status: :confirmed)
    assert other.reload.confirmed?
  end

  test "overlapping instructor or student meetings are rejected by exclusion constraints" do
    booking
    other = booking.dup
    other.status = :canceled
    other.week_number = 2
    other.enrollment = Enrollment.create!(user: person, cohort: course)
    other.private_meeting_slot = meeting_config.private_meeting_slots.create!(instructor: staff, starts_at: slot.starts_at + 2.hours, ends_at: slot.ends_at + 2.hours)
    other.save!
    assert_database_rejects other, { status: :confirmed }, ActiveRecord::ExclusionViolation
    # Isolate the independent student overlap constraint from the instructor one.
    assert_database_rejects other, { status: :confirmed, instructor_id: person(:instructor).id }, ActiveRecord::ExclusionViolation
    booking.update!(status: :canceled)
    other.update!(status: :confirmed)
    assert other.confirmed?
  end

  test "destroy cascades booking events and their notifications" do
    event = booking.private_meeting_booking_events.create!(actor: staff, action: "booked")
    note = Notification.create!(user: student, notifiable: event, notification_type: :system, title: "Booked", path: "/meetings")
    booking.destroy!
    assert_not PrivateMeetingBookingEvent.exists?(event.id)
    assert_not Notification.exists?(note.id)
  end
end
