class RecordDetail
  # One activity event (L-5.2): what happened, who did it, to whom, when, in
  # which cohort, and the record it is about, linked when the viewer can open
  # it. Same audience as the activity feeds (ActivityEventsController): admins
  # see every event; an instructor sees events in cohorts they teach and their
  # own history (a grant of editing access names them as the subject).
  #
  # The subject record is linked only when it belongs to the event's cohort
  # and learner, as the feed's destinations require: a submission by that
  # learner in that cohort, a lesson block on the cohort's curriculum, or a
  # recording of that cohort.
  class ActivityEventPage < Base
    CATEGORIES = Api::V1::ActivityEventsController::CATEGORIES

    private

    def authorized?
      cohort_id, subject_id = ActivityEvent.where(id: @id).pick(:cohort_id, :subject_user_id)
      return false unless subject_id

      admin? || subject_id == @viewer.id || (cohort_id.present? && scope.visible?(cohort_id))
    end

    def build
      event = ActivityEvent.includes(:actor, :subject_user, :cohort).find(@id)
      record = load_record(event)

      {
        type: "activity_event",
        id: event.id,
        event_type: event.event_type,
        category: CATEGORIES.find { |_, types| types.include?(event.event_type) }&.first,
        evidence: event.evidence,
        created_at: event.created_at.iso8601,
        actor: person(event.actor).merge(role: event.actor.role),
        subject: person(event.subject_user).merge(role: event.subject_user.role),
        cohort: event.cohort && (scope.visible?(event.cohort_id) ? cohort_json(event.cohort) : nil),
        record_type: event.record_type,
        record_label: record_label(record),
        record: record_link(event, record)
      }
    end

    def load_record(event)
      case event.record_type
      when "Submission" then Submission.includes(:enrollment, content_block: :lesson).find_by(id: event.record_id)
      when "ContentBlock" then ContentBlock.includes(lesson: :curriculum_module).find_by(id: event.record_id)
      when "Recording" then ::Recording.find_by(id: event.record_id)
      end
    end

    def record_label(record)
      case record
      when Submission then record.content_block.display_title(fallback: "Exercise")
      when ContentBlock then record.display_title(fallback: record.lesson&.title || "Lesson")
      when ::Recording then record.title
      end
    end

    # Where the subject opens, or nil when it isn't in a cohort the viewer can see.
    def record_link(event, record)
      cohort = event.cohort
      return nil unless record && cohort && scope.visible?(cohort.id)

      case record
      when Submission
        return nil unless record.user_id == event.subject_user_id && record.enrollment&.cohort_id == cohort.id

        { kind: "submission", id: record.id, cohort_id: cohort.id, student_id: event.subject_user_id, lesson_id: record.content_block.lesson_id, content_block_id: record.content_block_id }
      when ContentBlock
        return nil unless record.lesson&.curriculum_module&.curriculum_id == cohort.curriculum_id

        { kind: "lesson", id: record.lesson_id, cohort_id: cohort.id, student_id: event.subject_user_id, lesson_id: record.lesson_id, content_block_id: record.id }
      when ::Recording
        return nil unless record.cohort_id == cohort.id

        { kind: "recording", id: record.id, cohort_id: cohort.id, student_id: event.subject_user_id, lesson_id: nil, content_block_id: nil }
      end
    end
  end
end
