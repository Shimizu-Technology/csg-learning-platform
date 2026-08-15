class EnrollmentRestartService
  class Conflict < StandardError; end

  def initialize(enrollment:, performed_by:, reason: nil)
    @enrollment = enrollment
    @student = enrollment.user
    @cohort = enrollment.cohort
    @performed_by = performed_by
    @reason = reason.to_s.strip.presence
  end

  def call
    EnrollmentRestart.transaction do
      student.lock!
      enrollment.lock!
      ensure_unambiguous_curriculum!

      block_ids = ContentBlock.joins(lesson: :curriculum_module)
        .where(modules: { curriculum_id: cohort.curriculum_id })
        .pluck(:id)
      recording_ids = cohort.recordings.pluck(:id)

      progresses = student.progresses.where(content_block_id: block_ids)
      submissions = student.submissions.where(content_block_id: block_ids)
      knowledge_check_attempts = student.knowledge_check_attempts
        .joins(:knowledge_check)
        .where(knowledge_checks: { content_block_id: block_ids })
      watch_progresses = student.watch_progresses.where(recording_id: recording_ids)
      lesson_assignments = enrollment.lesson_assignments
      submission_notifications = Notification.where(notifiable_type: "Submission", notifiable_id: submissions.select(:id))

      snapshot = {
        enrollment: enrollment.attributes,
        progresses: progresses.map(&:attributes),
        submissions: submissions.map(&:attributes),
        knowledge_check_attempts: knowledge_check_attempts.map(&:attributes),
        watch_progresses: watch_progresses.map(&:attributes),
        lesson_assignments: lesson_assignments.map(&:attributes),
        module_assignments: enrollment.module_assignments.map(&:attributes),
        submission_notifications: submission_notifications.map(&:attributes)
      }

      counts = {
        progresses: progresses.length,
        submissions: submissions.length,
        knowledge_check_attempts: knowledge_check_attempts.length,
        watch_progresses: watch_progresses.length,
        lesson_assignments: lesson_assignments.length,
        submission_notifications: submission_notifications.length
      }

      restart = EnrollmentRestart.create!(
        enrollment: enrollment,
        student: student,
        cohort: cohort,
        performed_by: performed_by,
        reason: reason,
        snapshot: snapshot,
        records_removed: counts
      )

      previous_restart_interventions = enrollment.interventions.active.trigger_type_restart.to_a
      previous_restart_interventions.each { |record| record.notifications.update_all(read_at: Time.current, updated_at: Time.current) }
      Intervention.where(id: previous_restart_interventions.map(&:id)).update_all(status: Intervention.statuses.fetch("canceled"), resolved_at: Time.current, updated_at: Time.current)
      enrollment.recovery_plans.status_active.update_all(status: RecoveryPlan.statuses.fetch("canceled"), completed_at: Time.current, updated_at: Time.current)

      submission_notifications.delete_all
      submissions.delete_all
      knowledge_check_attempts.delete_all
      progresses.delete_all
      watch_progresses.delete_all
      lesson_assignments.delete_all
      enrollment.module_assignments.update_all(unlock_date_override: nil, updated_at: Time.current)
      enrollment.update!(
        status: :active,
        enrolled_at: Time.current,
        completed_at: nil,
        learning_state_reset_at: Time.current
      )

      follow_up_at = 1.week.from_now
      intervention = enrollment.interventions.create!(
        trigger_type: :restart,
        severity: :normal,
        status: :monitoring,
        evidence_snapshot: InterventionEvidenceBuilder.new(enrollment: enrollment, trigger_type: :restart).call,
        owner: performed_by,
        created_by: performed_by,
        action_summary: reason || "Support the student's return to a sustainable weekly pace.",
        next_follow_up_at: follow_up_at
      )
      RecoveryPlan.create!(
        enrollment: enrollment,
        enrollment_restart: restart,
        intervention: intervention,
        owner: performed_by,
        created_by: performed_by,
        source: :restart,
        status: :active,
        target_pace: "Return to the cohort's current weekly pace",
        required_scope: "Repeat required curriculum checkpoints from the beginning.",
        optional_scope: "Use optional practice and recordings where they support the required work.",
        check_in_cadence: "weekly",
        next_check_in_at: follow_up_at
      )

      restart
    end
  end

  private

  attr_reader :enrollment, :student, :cohort, :performed_by, :reason

  def ensure_unambiguous_curriculum!
    overlapping = student.enrollments
      .joins(:cohort)
      .where(cohorts: { curriculum_id: cohort.curriculum_id })
      .where.not(id: enrollment.id)

    return unless overlapping.exists?

    raise Conflict, "This student has another enrollment using the same curriculum. Remove that enrollment before restarting this one."
  end
end
