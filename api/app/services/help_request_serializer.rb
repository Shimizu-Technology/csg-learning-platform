class HelpRequestSerializer
  def self.as_json(help_request, include_student: false, include_follow_up: false)
    context_path = LearningDestination.help_request(help_request)
    context_destination = RecordDestination.from_path(context_path)
    payload = {
      id: help_request.id,
      cohort: { id: help_request.cohort_id, name: help_request.cohort.name },
      context_type: help_request.context_type,
      context_source: help_request.context_source,
      context_id: help_request.context_id,
      context_label: help_request.context_label,
      context_path: context_path,
      context_destination: context_destination,
      destination: include_student ? RecordDestination.build(kind: "help_request", id: help_request.id) : context_destination,
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
      },
      # Oldest first. Requests resolved before replies existed have none; their
      # one response is `staff_response`.
      replies: help_request.replies.map { |reply| reply_json(reply) }
    }
    if include_student
      payload[:student] = {
        id: help_request.student.id,
        full_name: help_request.student.full_name,
        email: help_request.student.email
      }
    end
    # The record page only (one request), so lists never load plans per row.
    payload[:follow_up] = follow_up_json(help_request) if include_student && include_follow_up
    payload
  end

  def self.reply_json(reply)
    {
      id: reply.id,
      body: reply.body,
      resolved_request: reply.resolved_request,
      author: { id: reply.author.id, full_name: reply.author.full_name },
      created_at: reply.created_at
    }
  end

  # Staff only: the latest follow-up plan started from this request, when the
  # cohort runs follow-up plans. Students never see follow-up plans.
  def self.follow_up_json(help_request)
    return nil unless FeatureSwitches.for(cohort: help_request.cohort)["interventions"]

    plan = help_request.interventions.joins(:enrollment).where(enrollments: { cohort_id: help_request.cohort_id }).order(created_at: :desc, id: :desc).first
    plan && {
      id: plan.id,
      status: plan.status,
      destination: RecordDestination.build(kind: "follow_up", id: plan.id)
    }
  end
end
