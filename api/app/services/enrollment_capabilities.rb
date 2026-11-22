class EnrollmentCapabilities
  def self.for(enrollment, features: FeatureSwitches.for(cohort: enrollment.cohort), blocked_support: nil)
    can_submit = enrollment.active?
    support_mode = if enrollment.guided_help_available?
      "guided_help"
    elsif course_questions_available?(enrollment, blocked_support: blocked_support)
      "course_question"
    else
      "none"
    end

    {
      live_support: !enrollment.cohort.self_paced?,
      features: FeatureSwitches.for_client(features),
      can_submit: can_submit,
      read_only: !can_submit,
      support_mode: features["help_requests"] ? support_mode : "none",
      support_expires_at: enrollment.support_expires_at,
      access_expires_at: enrollment.access_expires_at,
      support_instructor_id: enrollment.cohort.support_instructor_id
    }
  end

  def self.course_questions_available?(enrollment, blocked_support: nil)
    cohort = enrollment.cohort
    instructor = cohort.support_instructor
    return false unless cohort.self_paced? && enrollment.instructor_support_active? && instructor&.staff? && !instructor.archived?
    return false if cohort.completed? || cohort.archived? || cohort.workspace&.archived?
    return false if blocked_support.nil? ? UserBlock.between(enrollment.user_id, [ instructor.id ]).exists? : blocked_support

    true
  end
end
