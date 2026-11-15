require_relative "../support/model_coverage"

class PrivateMeetingBookingTest < ModelCoverageTestCase
  test "database enforces positive range and week count and one confirmed booking per slot and per enrollment week" do
    booking
    assert_invalid booking, :zoom_url, "http://example.com/meeting"
    booking.update!(zoom_url: "https://example.com/meeting")
    assert_database_rejects booking, { ends_at: booking.starts_at }, constraint: "private_meeting_booking_valid_range"
    assert_database_rejects booking, { week_number: 0 }, constraint: "private_meeting_booking_valid_range"
    assert_database_rejects booking, { student_change_count: -1 }, constraint: "private_meeting_booking_valid_range"

    # Each candidate is hours away from `booking`, so neither overlap exclusion can
    # fire and only the named partial unique index can reject the confirmation.
    classmate = person
    same_slot = booking.dup
    same_slot.assign_attributes(status: :canceled, enrollment: Enrollment.create!(user: classmate, cohort: course), student: classmate,
      week_number: 2, starts_at: booking.starts_at + 3.hours, ends_at: booking.ends_at + 3.hours)
    same_slot.save!
    assert_database_rejects same_slot, { status: :confirmed }, ActiveRecord::RecordNotUnique, constraint: "private_meeting_one_confirmed_per_slot"

    later_slot = meeting_config.private_meeting_slots.create!(instructor: staff, starts_at: slot.starts_at + 6.hours, ends_at: slot.ends_at + 6.hours)
    same_week = booking.dup
    same_week.assign_attributes(status: :canceled, private_meeting_slot: later_slot, starts_at: later_slot.starts_at, ends_at: later_slot.ends_at)
    same_week.save!
    assert_database_rejects same_week, { status: :confirmed }, ActiveRecord::RecordNotUnique, constraint: "private_meeting_one_confirmed_per_week"

    booking.update!(status: :canceled)
    same_slot.update!(status: :confirmed)
    same_week.update!(status: :confirmed)
    assert same_slot.reload.confirmed?
    assert same_week.reload.confirmed?
  end

  test "overlapping instructor or student meetings are rejected by exclusion constraints" do
    booking
    classmate = person
    other = booking.dup
    other.status = :canceled
    other.week_number = 2
    other.enrollment = Enrollment.create!(user: classmate, cohort: course)
    other.student = classmate
    other.private_meeting_slot = meeting_config.private_meeting_slots.create!(instructor: staff, starts_at: slot.starts_at + 2.hours, ends_at: slot.ends_at + 2.hours)
    other.save!
    # Same instructor, different student: only the instructor exclusion applies.
    assert_database_rejects other, { status: :confirmed }, ActiveRecord::ExclusionViolation, constraint: "private_meeting_bookings_no_instructor_overlap"
    # Same student, different instructor: only the student exclusion applies.
    assert_database_rejects other, { status: :confirmed, instructor_id: person(:instructor).id, student_id: student.id }, ActiveRecord::ExclusionViolation,
      constraint: "private_meeting_bookings_no_student_overlap"
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
