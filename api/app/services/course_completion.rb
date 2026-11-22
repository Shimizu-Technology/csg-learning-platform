class CourseCompletion
  class Unavailable < StandardError; end

  def self.enabled?(enrollment, features: nil)
    (features || FeatureSwitches.for(cohort: enrollment.cohort))["certificates"] == true
  end

  def self.evaluate!(enrollment, actor: nil)
    return unless enrollment && enabled?(enrollment)

    enrollment.with_lock do
      next if enrollment.dropped? || enrollment.paused? || !enabled?(enrollment)
      next unless LearnerProgress.new(enrollment).course_completed?

      mark_completed!(enrollment)
      # Only an explicit staff action can replace a revoked certificate.
      issue!(enrollment, actor: actor) unless enrollment.certificates.exists?
    end
  end

  def self.reissue!(enrollment, actor:, reason:)
    enrollment.with_lock do
      active = enrollment.certificates.active.first
      unless active || enabled?(enrollment)
        raise Unavailable, "Certificates are disabled for this course"
      end
      if enrollment.dropped? || enrollment.paused?
        raise Unavailable, "Resume this enrollment before issuing a certificate"
      end

      if enrollment.completed_at.present? || LearnerProgress.new(enrollment).course_completed?
        mark_completed!(enrollment)
      end
      active&.update!(revoked_at: Time.current, revoked_by: actor, revocation_reason: reason)
      issue!(enrollment, actor: actor, reason: reason, holder_name: active&.holder_name || enrollment.certificates.order(id: :desc).first&.holder_name)
    end
  end

  def self.revoke!(enrollment, actor:, reason:)
    enrollment.with_lock do
      active = enrollment.certificates.active.first
      raise Unavailable, "There is no active certificate to revoke" unless active

      active.update!(revoked_at: Time.current, revoked_by: actor, revocation_reason: reason)
      active
    end
  end

  # Only opted-in or already credentialed learners get these keys.
  def self.learner_summary(enrollment, progress: nil, features: nil)
    certificate = enrollment.active_certificate
    return {} unless certificate || enabled?(enrollment, features: features)

    completed = enrollment.completed_at.present?
    handed_in = completed || (progress || LearnerProgress.new(enrollment)).all_required_work_handed_in?
    {
      course_completion: {
        enrollment_id: enrollment.id,
        all_work_handed_in: handed_in,
        course_completed: completed,
        certificate: certificate&.verification_json,
        next_step: completed ? CohortNextStep.for(enrollment.cohort) : nil
      }
    }
  end

  def self.staff_summary(enrollment)
    active = enrollment.active_certificate
    enabled = enabled?(enrollment)
    return {} unless active || enabled

    latest = active || enrollment.certificates.order(id: :desc).first
    {
      course_certificate: {
        certificate: latest&.verification_json,
        can_issue: !enrollment.dropped? && !enrollment.paused?,
        course_completed: enrollment.completed_at.present?
      }
    }
  end

  def self.mark_completed!(enrollment)
    enrollment.update!(completed_at: Time.current) unless enrollment.completed_at
  end

  def self.issue!(enrollment, actor:, reason: nil, holder_name: nil)
    cohort = enrollment.cohort
    name = Certificate.normalize_value_for(:holder_name, holder_name || enrollment.user.full_name)
    # Legacy accounts can lack a name or use an email in their name fields.
    # Never copy an address into a public snapshot.
    name = "Learner" if name.blank? || name.include?("@")
    enrollment.certificates.create!(
      code: Certificate.generate_code,
      holder_name: name.first(120),
      course_title: cohort.public_title.presence || cohort.curriculum.name,
      issuer_name: SchoolBrand.current.name,
      wording_version: Certificate::WORDING_VERSION,
      issued_at: Time.current,
      issued_by: actor,
      issuance_reason: reason
    )
  end

  private_class_method :mark_completed!, :issue!
end
