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
      ct
    else
      render json: { error: "content_type must be a video/* MIME type" }, status: :unprocessable_entity
      nil
    end
  end

  def authorize_content_block_write!(content_block)
    return if current_user.staff?

    lesson = content_block.lesson
    enrollment = current_user.enrollments
      .active
      .joins(:cohort)
      .includes(:cohort, :module_assignments, :lesson_assignments)
      .find_by(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })

    unless enrollment
      render_forbidden("Not enrolled in this curriculum")
      return
    end

    assignment = enrollment.module_assignments.find { |ma| ma.module_id == lesson.module_id }
    lesson_assignment = enrollment.lesson_assignments.find { |la| la.lesson_id == lesson.id }

    unless assignment&.accessible? || lesson_assignment.present?
      render_forbidden("Module is not accessible")
      return
    end

    unless lesson.available?(enrollment.cohort, assignment, lesson_assignment)
      render_forbidden("Lesson is not unlocked yet")
    end
  end
end
