class PrivateMeetingScheduler
  class InvalidRequest < StandardError; end
  class Conflict < StandardError; end

  BUFFER = 15.minutes

  def self.book!(student:, slot:)
    config = slot.private_meeting_config
    enrollment = student.enrollments.active.find_by(cohort_id: config.cohort_id)
    raise InvalidRequest, "Private meetings are not available for this class" unless config.enabled? && enrollment

    booking = nil
    config.instructor.with_lock do
      slot.reload.lock!
      week = validate_slot!(slot, config)
      raise Conflict, "This time was just booked. Choose another slot." if slot.booked?
      if PrivateMeetingBooking.confirmed.exists?(enrollment_id: enrollment.id, week_number: week)
        raise Conflict, "You already have a meeting for this course week"
      end

      past_changes = PrivateMeetingBooking.where(enrollment_id: enrollment.id, week_number: week).maximum(:student_change_count).to_i
      booking = PrivateMeetingBooking.create!(
        private_meeting_slot: slot,
        enrollment: enrollment,
        cohort: config.cohort,
        instructor: config.instructor,
        student: student,
        week_number: week,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        student_change_count: past_changes
      )
      event!(booking, student, "booked")
    end
    booking
  end

  def self.reschedule!(booking:, slot:, actor:)
    require_manager_or_student!(booking, actor)
    config = slot.private_meeting_config
    raise InvalidRequest, "Choose a time from the same class" unless config.cohort_id == booking.cohort_id

    config.instructor.with_lock do
      booking.reload.lock!
      slot.reload.lock!
      raise Conflict, "This meeting was canceled" unless booking.confirmed?
      week = validate_slot!(slot, config, allow_cutoff: actor.staff?)
      raise InvalidRequest, "Choose a time in the same course week" unless week == booking.week_number
      raise Conflict, "This time was just booked. Choose another slot." if slot.booked?
      if actor.id == booking.student_id
        validate_student_change!(booking, config)
      end

      old_start = booking.starts_at
      booking.update!(
        private_meeting_slot: slot,
        instructor: config.instructor,
        starts_at: slot.starts_at,
        ends_at: slot.ends_at,
        student_change_count: booking.student_change_count + (actor.id == booking.student_id ? 1 : 0)
      )
      event!(booking, actor, "rescheduled", previous_starts_at: old_start.iso8601)
    end
    booking
  end

  def self.cancel!(booking:, actor:)
    require_manager_or_student!(booking, actor)
    config = booking.cohort.private_meeting_config
    config.instructor.with_lock do
      booking.reload.lock!
      raise Conflict, "This meeting was already canceled" unless booking.confirmed?
      validate_student_change!(booking, config) if actor.id == booking.student_id

      booking.update!(status: :canceled, student_change_count: booking.student_change_count + (actor.id == booking.student_id ? 1 : 0))
      event!(booking, actor, "canceled")
    end
    booking
  end

  def self.validate_slot!(slot, config, allow_cutoff: false)
    raise Conflict, "This time is no longer available" unless slot.active? && config.enabled?
    if !allow_cutoff && slot.starts_at < Time.current + config.reschedule_cutoff_hours.hours
      raise InvalidRequest, "This time has already passed the booking cutoff"
    end
    raise InvalidRequest, "This time has already passed" unless slot.starts_at > Time.current

    config.week_for(slot.starts_at) || raise(InvalidRequest, "This time is outside the course")
  end

  def self.validate_student_change!(booking, config)
    if booking.student_change_count >= config.max_student_changes
      raise InvalidRequest, "You have used your learner-requested schedule change; message your instructor"
    end
    if booking.starts_at < Time.current + config.reschedule_cutoff_hours.hours
      raise InvalidRequest, "Changes close #{config.reschedule_cutoff_hours} hours before the meeting; message your instructor"
    end
  end

  def self.require_manager_or_student!(booking, actor)
    if actor.id == booking.student_id
      raise InvalidRequest, "Private meetings require an active enrollment" unless booking.enrollment.active?
      return
    end
    return if actor.admin? || actor.id == booking.instructor_id

    raise InvalidRequest, "You cannot change this meeting"
  end

  def self.event!(booking, actor, action, details = {})
    event = booking.private_meeting_booking_events.create!(actor: actor, action: action, details: details)
    [ booking.student, booking.instructor ].uniq.each do |recipient|
      Notification.create!(
        user: recipient,
        actor: actor,
        notifiable: event,
        notification_type: :system,
        title: "Private meeting #{action.tr('_', ' ')}",
        body: booking.starts_at.in_time_zone("Pacific/Guam").strftime("%b %-d at %-I:%M %p Guam time"),
        path: recipient.id == booking.student_id ? "/meetings" : "/admin/meetings"
      )
    end
    event
  end

  private_class_method :validate_student_change!, :require_manager_or_student!
end
