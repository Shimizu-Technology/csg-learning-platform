class RecoveryPlanSerializer
  def self.as_json(plan, include_check_ins: false)
    enrollment = plan.enrollment
    payload = {
      id: plan.id,
      source: plan.source,
      status: plan.status,
      target_pace: plan.target_pace,
      required_scope: plan.required_scope,
      optional_scope: plan.optional_scope,
      check_in_cadence: plan.check_in_cadence,
      next_check_in_at: plan.next_check_in_at,
      last_check_in_at: plan.last_check_in_at,
      check_in_due: plan.status_active? && plan.next_check_in_at <= Time.current,
      outcome: plan.outcome,
      completed_at: plan.completed_at,
      created_at: plan.created_at,
      updated_at: plan.updated_at,
      enrollment: {
        id: enrollment.id,
        status: enrollment.status,
        student: { id: enrollment.user_id, full_name: enrollment.user.full_name, email: enrollment.user.email },
        cohort: { id: enrollment.cohort_id, name: enrollment.cohort.name }
      },
      owner: { id: plan.owner_id, full_name: plan.owner.full_name },
      created_by: { id: plan.created_by_id, full_name: plan.created_by.full_name },
      enrollment_restart_id: plan.enrollment_restart_id,
      intervention_id: plan.intervention_id
    }
    payload[:check_ins] = plan.check_ins.order(created_at: :asc).map { |check_in| check_in_json(check_in) } if include_check_ins
    payload
  end

  def self.check_in_json(check_in)
    {
      id: check_in.id,
      body: check_in.body,
      next_check_in_at: check_in.next_check_in_at,
      author: { id: check_in.author_id, full_name: check_in.author.full_name },
      created_at: check_in.created_at
    }
  end
end
