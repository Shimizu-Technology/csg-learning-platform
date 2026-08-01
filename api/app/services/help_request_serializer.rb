class HelpRequestSerializer
  def self.as_json(help_request, include_student: false)
    payload = {
      id: help_request.id,
      cohort: { id: help_request.cohort_id, name: help_request.cohort.name },
      context_type: help_request.context_type,
      context_source: help_request.context_source,
      context_id: help_request.context_id,
      context_label: help_request.context_label,
      context_path: help_request.context_path,
      category: help_request.category,
      urgency: help_request.urgency,
      status: help_request.status,
      message: help_request.message,
      staff_response: help_request.staff_response,
      acknowledged_at: help_request.acknowledged_at,
      resolved_at: help_request.resolved_at,
      canceled_at: help_request.canceled_at,
      created_at: help_request.created_at,
      updated_at: help_request.updated_at,
      owner: help_request.owner && {
        id: help_request.owner.id,
        full_name: help_request.owner.full_name
      }
    }
    if include_student
      payload[:student] = {
        id: help_request.student.id,
        full_name: help_request.student.full_name,
        email: help_request.student.email
      }
    end
    payload
  end
end
