class InterventionSerializer
  def self.as_json(intervention, include_notes: false)
    enrollment = intervention.enrollment
    payload = {
      id: intervention.id,
      trigger_type: intervention.trigger_type,
      severity: intervention.severity,
      status: intervention.status,
      evidence_snapshot: intervention.evidence_snapshot,
      action_summary: intervention.action_summary,
      next_follow_up_at: intervention.next_follow_up_at,
      follow_up_due: intervention.active? && intervention.next_follow_up_at.present? && intervention.next_follow_up_at <= Time.current,
      outcome: intervention.outcome,
      resolution_summary: intervention.resolution_summary,
      resolved_at: intervention.resolved_at,
      created_at: intervention.created_at,
      updated_at: intervention.updated_at,
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        student: {
          id: enrollment.user_id,
          full_name: enrollment.user.full_name,
          email: enrollment.user.email
        },
        cohort: {
          id: enrollment.cohort_id,
          name: enrollment.cohort.name
        }
      },
      owner_valid: intervention.owner_valid?,
      owner: person(intervention.owner),
      created_by: person(intervention.created_by),
      help_request_id: intervention.help_request_id,
      recovery_plan_id: intervention.recovery_plan&.id
    }
    if include_notes
      payload[:notes] = intervention.notes.order(created_at: :asc).map { |note| note_json(note) }
      payload[:evidence_links] = evidence_links(intervention)
    end
    payload
  end

  # The records the saved evidence names (L-2.5), as destinations staff can
  # open: submissions still in this enrollment, the source help request and
  # the lesson it was asked from when they belong to this cohort. Ids that no
  # longer resolve are left out, so the page shows them as plain text.
  def self.evidence_links(intervention)
    snapshot = intervention.evidence_snapshot || {}
    enrollment = intervention.enrollment
    cohort_id = enrollment.cohort_id
    links = []

    submission_ids = Array(snapshot["submission_ids"]).map(&:to_s).grep(/\A[1-9]\d{0,18}\z/).map(&:to_i).first(50)
    if submission_ids.any?
      found = Submission.where(id: submission_ids, enrollment_id: enrollment.id).pluck(:id).to_set
      submission_ids.each do |id|
        next unless found.include?(id)

        links << { key: "submission_ids", id: id, label: "Submission ##{id}", destination: RecordDestination.build(kind: "submission", id: id, context: { cohort_id: cohort_id, student_id: enrollment.user_id }) }
      end
    end

    help_request_id = snapshot["help_request_id"].to_s
    if help_request_id.match?(/\A[1-9]\d{0,18}\z/)
      request = HelpRequest.find_by(id: help_request_id.to_i, cohort_id: cohort_id)
      if request
        links << { key: "help_request_id", id: request.id, label: request.context_label, destination: RecordDestination.build(kind: "help_request", id: request.id, context: { cohort_id: cohort_id, student_id: request.student_id }) }
        lesson = evidence_lesson(request, enrollment.cohort)
        links << { key: "context_id", id: lesson.id, label: lesson.title, destination: RecordDestination.build(kind: "lesson", id: lesson.id, context: { cohort_id: cohort_id }) } if lesson
      end
    end
    links
  end

  # The lesson a help request was asked from, when it's on the cohort's curriculum.
  def self.evidence_lesson(request, cohort)
    lesson = case request.context_type
    when "lesson" then Lesson.includes(:curriculum_module).find_by(id: request.context_id)
    when "exercise" then ContentBlock.includes(lesson: :curriculum_module).find_by(id: request.context_id)&.lesson
    end
    lesson if lesson&.curriculum_module&.curriculum_id == cohort.curriculum_id
  end

  def self.note_json(note)
    {
      id: note.id,
      body: note.body,
      author: person(note.author),
      created_at: note.created_at,
      updated_at: note.updated_at
    }
  end

  def self.person(user)
    { id: user.id, full_name: user.full_name }
  end

  private_class_method :person, :evidence_lesson
end
