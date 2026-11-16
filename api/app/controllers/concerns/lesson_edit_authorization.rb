# Lesson authoring checks shared by every path that changes a lesson's
# content: the web block editor, the legacy block endpoints, objective
# alignments and installed mobile builds' PATCH /lessons/:id/editor. See
# LessonEditAccess for the rules.
module LessonEditAuthorization
  extend ActiveSupport::Concern

  included do
    rescue_from LessonEditAccess::Denied do |error|
      render_forbidden(error.message, code: error.code)
    end
  end

  private

  # Early refusal before any work; call from a before_action.
  def require_lesson_edit_access!(curriculum)
    access = LessonEditAccess.for(current_user, curriculum)
    render_forbidden(access.refusal_message, code: access.refusal_code) unless access.can_edit?
    access
  end

  # Inside the write's transaction, before the lesson is locked: re-reads the
  # grant under FOR SHARE so a revoke can't slip between the check and the
  # commit. Raises LessonEditAccess::Denied.
  def recheck_lesson_edit_access!(curriculum)
    LessonEditAccess.authorize!(current_user, curriculum, lock: true)
  end

  def require_lesson_media_upload_access!
    return if LessonEditAccess.any_grant?(current_user)

    render_forbidden("Only admins and instructors with lesson editing access can upload lesson media.", code: "lesson_editing_not_granted")
  end
end
