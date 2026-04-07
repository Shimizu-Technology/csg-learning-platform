class ApplicationController < ActionController::API
  include ClerkAuthenticatable

  private

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

    unless assignment&.unlocked? || lesson_assignment.present?
      render_forbidden("Module is not accessible")
      return
    end

    unless lesson.available?(enrollment.cohort, assignment, lesson_assignment)
      render_forbidden("Lesson is not unlocked yet")
    end
  end
end
