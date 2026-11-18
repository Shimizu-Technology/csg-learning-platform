class RecordDetail
  # Shared subject boundary for detail pages and staff feeds. Membership is
  # loaded for the whole page, never queried while serializing individual events.
  class ActivitySubject
    def initialize(viewer:, events:)
      @scope = StaffCohortScope.new(viewer)
      cohort_ids = events.filter_map(&:cohort_id).uniq
      user_ids = events.map(&:subject_user_id).uniq
      @admins = User.where(id: user_ids, role: :admin).pluck(:id).to_set
      @members = Enrollment.where(cohort_id: cohort_ids, user_id: user_ids).pluck(:cohort_id, :user_id).to_set
      @members.merge(CohortInstructorAssignment.where(cohort_id: cohort_ids, user_id: user_ids).pluck(:cohort_id, :user_id))
    end

    def member?(cohort_id, user_id)
      @admins.include?(user_id) || @members.include?([ cohort_id, user_id ])
    end

    # Where the subject opens, or nil when it isn't in a cohort the viewer can see.
    def link(event, record)
      cohort = event.cohort
      return nil unless record && cohort && @scope.visible?(cohort.id)
      # The link carries the subject as its learner, so the subject must be one of the cohort's people.
      return nil unless member?(cohort.id, event.subject_user_id)

      case record
      when Submission
        return nil unless record.user_id == event.subject_user_id && record.enrollment&.cohort_id == cohort.id
        return nil unless record.content_block&.lesson&.curriculum_module&.curriculum_id == cohort.curriculum_id

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
