class RecordDetail
  # One activity event (L-5.2): what happened, who did it, to whom, when, in
  # which cohort, and the record it is about, linked when the viewer can open
  # it. Same audience as the activity feeds (ActivityEventsController): admins
  # see every event; an instructor sees events in cohorts they teach and their
  # own history (a grant of editing access names them as the subject).
  #
  # An instructor who comes in through the event's cohort (not as its admin or
  # its subject) sees it only when the people it names, the subject and the
  # actor, belong to that cohort (enrolled, teaching it, or admins), so an
  # event can't carry another cohort's learner into a cohort they teach.
  #
  # The subject record is shown only when it belongs to the event's cohort
  # and learner, as the feed's destinations require: a submission by that
  # learner in that cohort on an exercise of the cohort's curriculum, a lesson
  # block on the cohort's curriculum, or a recording of that cohort, in a
  # cohort the viewer can see, about one of its members. Its label (an
  # exercise, lesson or recording title) and its ids pass the same check as
  # its link, so an event pointing elsewhere never names or numbers it.
  # ("Make a copy for this cohort" moves submissions onto the copy's blocks,
  # so a cohort's own work is always on its curriculum.)
  class ActivityEventPage < Base
    CATEGORIES = Api::V1::ActivityEventsController::CATEGORIES

    private

    def authorized?
      cohort_id, subject_id, actor_id = ActivityEvent.where(id: @id).pick(:cohort_id, :subject_user_id, :actor_id)
      return false unless subject_id
      return true if admin? || subject_id == @viewer.id

      cohort_id.present? && scope.visible?(cohort_id) && cohort_members?(cohort_id, [ subject_id, actor_id ])
    end

    # Each person is enrolled in the cohort, teaches it, or is an admin. One query.
    def cohort_members?(cohort_id, user_ids)
      ids = user_ids.uniq
      members = User.where(id: ids).where(
        "users.role = :admin OR EXISTS (SELECT 1 FROM enrollments WHERE enrollments.user_id = users.id AND enrollments.cohort_id = :cohort) " \
        "OR EXISTS (SELECT 1 FROM cohort_instructor_assignments WHERE cohort_instructor_assignments.user_id = users.id AND cohort_instructor_assignments.cohort_id = :cohort)",
        admin: User.roles[:admin], cohort: cohort_id
      ).count
      members == ids.size
    end

    def build
      event = ActivityEvent.includes(:actor, :subject_user, :cohort).find(@id)
      record = load_record(event)
      link = record_link(event, record)

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
        record_label: link ? record_label(record) : nil,
        record: link
      }
    end

    def load_record(event)
      case event.record_type
      when "Submission" then Submission.includes(:enrollment, content_block: { lesson: :curriculum_module }).find_by(id: event.record_id)
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

    def record_link(event, record)
      ActivitySubject.new(viewer: @viewer, events: [ event ]).link(event, record)
    end
  end
end
