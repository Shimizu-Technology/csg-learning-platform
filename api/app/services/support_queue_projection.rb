class SupportQueueProjection
  RECENT_RESOLVED_LIMIT = 20

  def initialize(now: Time.current, cohort_ids: nil)
    @now = now
    @cohort_ids = cohort_ids
  end

  def call
    active_requests = scoped(HelpRequest.active_queue).includes(:cohort, :student, :owner).queue_order.to_a
    resolved = scoped(HelpRequest.status_resolved).includes(:cohort, :student, :owner).order(resolved_at: :desc).limit(RECENT_RESOLVED_LIMIT)
    attention = AttentionProjection.new(now: @now, cohort_ids: @cohort_ids).call
    students = attention[:students]
    intervention_scope = Intervention.active
    intervention_scope = intervention_scope.joins(:enrollment).where(enrollments: { cohort_id: @cohort_ids }) if @cohort_ids
    active_interventions = intervention_scope.includes(enrollment: [ :user, :cohort ], owner: [], created_by: [], recovery_plan: []).recent_first.to_a
    due_interventions = active_interventions.count { |intervention| intervention.next_follow_up_at.present? && intervention.next_follow_up_at <= @now }
    recovery_scope = RecoveryPlan.status_active
    recovery_scope = recovery_scope.joins(:enrollment).where(enrollments: { cohort_id: @cohort_ids }) if @cohort_ids
    active_recovery_plans = recovery_scope.includes(enrollment: [ :user, :cohort ], owner: [], created_by: []).to_a

    {
      generated_at: @now,
      summary: {
        open_help_count: active_requests.count(&:status_open?),
        acknowledged_help_count: active_requests.count(&:status_acknowledged?),
        urgent_help_count: active_requests.count(&:urgency_urgent?),
        **attention[:summary],
        active_intervention_count: active_interventions.size,
        due_follow_up_count: due_interventions,
        active_recovery_plan_count: active_recovery_plans.size,
        due_recovery_check_in_count: active_recovery_plans.count { |plan| plan.next_check_in_at <= @now }
      },
      help_requests: active_requests.map { |request| HelpRequestSerializer.as_json(request, include_student: true) },
      recently_resolved: resolved.map { |request| HelpRequestSerializer.as_json(request, include_student: true) },
      students: students,
      interventions: active_interventions.map { |intervention| InterventionSerializer.as_json(intervention) },
      recovery_plans: active_recovery_plans.map { |plan| RecoveryPlanSerializer.as_json(plan) }
    }
  end

  private

  def scoped(relation)
    @cohort_ids ? relation.where(cohort_id: @cohort_ids) : relation
  end
end
