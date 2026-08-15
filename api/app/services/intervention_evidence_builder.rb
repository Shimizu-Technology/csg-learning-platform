class InterventionEvidenceBuilder
  def initialize(enrollment:, trigger_type:, help_request: nil, now: Time.current)
    @enrollment = enrollment
    @trigger_type = trigger_type.to_s
    @help_request = help_request
    @now = now
  end

  def call
    case trigger_type
    when "help_request" then help_request_evidence
    when "redo" then submission_evidence("R")
    when "ungraded" then submission_evidence(nil)
    when "inactivity", "extended_absence" then inactivity_evidence
    when "restart" then restart_evidence
    else {}
    end
  end

  private

  attr_reader :enrollment, :trigger_type, :help_request, :now

  def help_request_evidence
    return {} unless help_request

    {
      help_request_id: help_request.id,
      category: help_request.category,
      urgency: help_request.urgency,
      context_type: help_request.context_type,
      context_id: help_request.context_id,
      created_at: help_request.created_at
    }
  end

  def submission_evidence(grade)
    submissions = enrollment_submissions.where(grade: grade).order(created_at: :desc).limit(20)
    {
      submission_ids: submissions.map(&:id),
      count: submissions.size,
      most_recent_at: submissions.first&.created_at
    }.compact
  end

  def inactivity_evidence
    last_activity_at = [
      enrollment.user.last_seen_at,
      enrollment.user.last_sign_in_at,
      enrollment_submissions.maximum(:created_at),
      Progress.where(user: enrollment.user, content_block_id: curriculum_block_ids).maximum(:completed_at)
    ].compact.max

    {
      last_activity_at: last_activity_at,
      inactive_days: last_activity_at ? ((now - last_activity_at) / 1.day).floor : nil,
      observed_at: now
    }.compact
  end

  def restart_evidence
    restart = EnrollmentRestart.where(enrollment: enrollment).order(created_at: :desc).first
    return {} unless restart

    {
      enrollment_restart_id: restart.id,
      restarted_at: restart.created_at,
      records_removed: restart.records_removed.slice("progresses", "submissions", "knowledge_check_attempts", "watch_progresses", "lesson_assignments")
    }
  end

  def enrollment_submissions
    Submission.where(user: enrollment.user, content_block_id: curriculum_block_ids)
  end

  def curriculum_block_ids
    @curriculum_block_ids ||= ContentBlock.joins(lesson: :curriculum_module)
      .where(modules: { curriculum_id: enrollment.cohort.curriculum_id })
      .select(:id)
  end
end
