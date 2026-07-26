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
      watch_progresses = student.watch_progresses.where(recording_id: recording_ids)
      lesson_assignments = enrollment.lesson_assignments
      submission_notifications = Notification.where(notifiable_type: "Submission", notifiable_id: submissions.select(:id))

      snapshot = {
        enrollment: enrollment.attributes,
        progresses: progresses.map(&:attributes),
        submissions: submissions.map(&:attributes),
        watch_progresses: watch_progresses.map(&:attributes),
        lesson_assignments: lesson_assignments.map(&:attributes),
        module_assignments: enrollment.module_assignments.map(&:attributes),
        submission_notifications: submission_notifications.map(&:attributes)
      }

      counts = {
        progresses: progresses.length,
        submissions: submissions.length,
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

      submission_notifications.delete_all
      submissions.delete_all
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
