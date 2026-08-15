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
      owner: person(intervention.owner),
      created_by: person(intervention.created_by),
      help_request_id: intervention.help_request_id,
      recovery_plan_id: intervention.recovery_plan&.id
    }
    payload[:notes] = intervention.notes.order(created_at: :asc).map { |note| note_json(note) } if include_notes
    payload
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

  private_class_method :person
end
