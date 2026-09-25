class PrivateMeetingSerializer
  def self.slot(slot, booked_ids: [])
    {
      id: slot.id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      instructor_id: slot.instructor_id,
      instructor_name: slot.instructor.full_name,
      available: slot.active? && !booked_ids.include?(slot.id)
    }
  end

  def self.booking(booking, staff: false)
    data = {
      id: booking.id,
      cohort_id: booking.cohort_id,
      instructor_name: booking.instructor.full_name,
      starts_at: booking.starts_at,
      ends_at: booking.ends_at,
      zoom_url: booking.zoom_url,
      status: booking.status,
      week_number: booking.week_number,
      reschedule_count: booking.student_change_count
    }
    data[:student_name] = booking.student.full_name if staff
    data
  end
end
