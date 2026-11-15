class CohortInstructorAssignment < ApplicationRecord
  belongs_to :cohort
  belongs_to :user
  # The admin who turned on lesson editing (LessonEditAccess). Kept for the
  # "Leon gave you this access on Nov 14" line; nulled if that account is
  # deleted.
  belongs_to :edit_granted_by, class_name: "User", optional: true

  validates :user_id, uniqueness: { scope: :cohort_id }
  validate :user_is_instructor
  validate :grant_is_complete

  # Staff presence streams follow cohort assignments. Reconnect the instructor
  # so their subscriptions pick up an added cohort or drop a removed one.
  # Lesson editing grants don't need this: no channel depends on them, and
  # every write re-checks the grant (LessonEditAccess).
  after_commit :reset_instructor_cable_connections, on: %i[create destroy]

  # Turns lesson editing on or off for this instructor on this cohort and
  # records who did it (ActivityEvent). Returns false when nothing changed.
  def set_lesson_editing!(enabled, by:)
    with_lock do
      return false if can_edit_lessons == enabled

      update!(can_edit_lessons: enabled, edit_granted_by: enabled ? by : nil, edit_granted_at: enabled ? Time.current : nil)
      ActivityEvent.record!(event_type: enabled ? "lesson_editing_granted" : "lesson_editing_revoked", actor: by, subject_user: user, cohort: cohort)
    end
    true
  end

  private

  def user_is_instructor
    errors.add(:user, "must be an instructor") unless user&.instructor?
  end

  def grant_is_complete
    return unless can_edit_lessons

    errors.add(:edit_granted_by, "must be an admin") unless edit_granted_by&.admin?
    errors.add(:edit_granted_at, "can't be blank") if edit_granted_at.blank?
  end

  def reset_instructor_cable_connections
    instructor = User.find_by(id: user_id)
    CableConnectionReset.call(instructor) if instructor
  end
end
