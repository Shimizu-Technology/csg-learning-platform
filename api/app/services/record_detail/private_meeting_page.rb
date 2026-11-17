class RecordDetail
  # One private-meeting booking (L-5.2): the student, the host, the time and
  # status, the meeting link, and what happened to it (booked, rescheduled,
  # link changed, canceled), with who did it. Bookings have no notes of their
  # own; the history is the record.
  #
  # Same rule as Meetings (StaffPrivateMeetingsController): admins see every
  # booking; an instructor sees only bookings they host, in cohorts they teach.
  # Another host's booking is a 404, even in a cohort they share.
  class PrivateMeetingPage < Base
    private

    def authorized?
      cohort_id, instructor_id = PrivateMeetingBooking.where(id: @id).pick(:cohort_id, :instructor_id)
      return false unless cohort_id

      admin? || (instructor_id == @viewer.id && scope.visible?(cohort_id))
    end

    def build
      booking = PrivateMeetingBooking.includes(:student, :instructor, cohort: :private_meeting_config).find(@id)
      cohort = booking.cohort
      events = booking.private_meeting_booking_events.includes(:actor).order(:created_at, :id).to_a

      {
        type: "private_meeting",
        id: booking.id,
        status: booking.status,
        starts_at: iso(booking.starts_at),
        ends_at: iso(booking.ends_at),
        week_number: booking.week_number,
        timezone: cohort.private_meeting_config&.timezone || OfficeHour::DEFAULT_TIMEZONE,
        zoom_url: booking.zoom_url,
        reschedule_count: booking.student_change_count,
        cohort: cohort_json(cohort),
        student: person(booking.student),
        host: person(booking.instructor),
        direct_conversation_id: conversation_id(cohort, booking.student),
        history: events.map do |event|
          previous = event.details.is_a?(Hash) ? event.details["previous_starts_at"] : nil
          { action: event.action, actor: person(event.actor), created_at: iso(event.created_at), previous_starts_at: previous.presence }
        end
      }
    end

    # The viewer's own conversation with the student in this cohort, if one exists.
    def conversation_id(cohort, student)
      workspace_id = Workspace.where(cohort_id: cohort.id).pick(:id)
      workspace_id && DirectConversation.visible_for(@viewer)
        .where(workspace_id: workspace_id, member_key: DirectConversation.member_key_for([ @viewer.id, student.id ])).pick(:id)
    end
  end
end
