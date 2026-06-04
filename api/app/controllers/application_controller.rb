class ApplicationController < ActionController::API
  include ClerkAuthenticatable

  # Permissive but strict-enough video MIME validator: matches `video/<subtype>`
  # for any valid subtype token, rejects everything else (image/, application/,
  # text/, blank, etc.). Used by every presign action so a forged content_type
  # can't be slipped into our S3 bucket as something the player won't render.
  VIDEO_MIME_PATTERN = /\Avideo\/[a-z0-9][a-z0-9.\-+]*\z/i

  private

  # Returns the validated, lowercased MIME if it matches `video/<subtype>`,
  # otherwise renders 422 and returns nil so the caller can `return if nil`.
  def validated_video_content_type(content_type)
    ct = content_type.to_s.strip
    if ct.match?(VIDEO_MIME_PATTERN)
      ct.downcase
    else
      render json: { error: "content_type must be a video/* MIME type" }, status: :unprocessable_entity
      nil
    end
  end

  def authorize_content_block_write!(content_block)
    return if current_user.staff?

    lesson = content_block.lesson
    enrollment = active_enrollment_for_lesson(lesson)

    unless enrollment
      render_forbidden("Not enrolled in this curriculum")
      return
    end

    assignment = enrollment.module_assignments.find { |ma| ma.module_id == lesson.module_id }
    lesson_assignment = enrollment.lesson_assignments.find { |la| la.lesson_id == lesson.id }

    unless assignment&.accessible?(enrollment.cohort) || lesson_assignment.present?
      render_forbidden("Module is not accessible")
      return
    end

    unless lesson.available?(enrollment.cohort, assignment, lesson_assignment)
      render_forbidden("Lesson is not unlocked yet")
    end
  end

  def authorize_submission_window_open!(content_block)
    return if current_user.staff?

    lesson = content_block.lesson
    enrollment = active_enrollment_for_lesson(lesson)
    return unless enrollment

    status = SubmissionWindowStatus.for_lesson(cohort: enrollment.cohort, lesson: lesson)
    return unless status[:submissions_closed]

    render_forbidden("Submissions for Week #{status[:week_number]} are closed")
  end

  def active_enrollment_for_lesson(lesson)
    current_user.enrollments
      .active
      .joins(:cohort)
      .includes(:module_assignments, :lesson_assignments, cohort: [ :cohort_module_schedules, :cohort_module_submission_windows ])
      .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
  end
end
