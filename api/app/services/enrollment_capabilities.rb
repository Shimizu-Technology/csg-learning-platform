class EnrollmentCapabilities
  def self.for(enrollment)
    can_submit = enrollment.active?
    support_mode = if enrollment.guided_help_available?
      "guided_help"
    elsif enrollment.cohort.self_paced? && enrollment.instructor_support_active? && enrollment.cohort.support_instructor_id.present?
      "course_question"
    else
      "none"
    end

    {
      can_submit: can_submit,
      read_only: !can_submit,
      support_mode: support_mode,
      support_expires_at: enrollment.support_expires_at,
      access_expires_at: enrollment.access_expires_at,
      support_instructor_id: enrollment.cohort.support_instructor_id
    }
  end
end
