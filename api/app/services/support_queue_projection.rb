class SupportQueueProjection
  RECENT_RESOLVED_LIMIT = 20

  # `lesson_id` / `module_id` narrow the help-request lists and help counts to
  # requests asked from that lesson (or its exercises), or from any lesson in
  # that module, still inside `cohort_ids`. A malformed id matches nothing.
  # The rest of the page (students, follow-up plans) is unchanged.
  def initialize(now: Time.current, cohort_ids: nil, lesson_id: nil, module_id: nil)
    @now = now
    @cohort_ids = cohort_ids
    @lesson_filter = lesson_id.present? ? (positive_id(lesson_id) || 0) : nil
    @module_filter = module_id.present? ? (positive_id(module_id) || 0) : nil
  end

  def call
    active_requests = scoped(HelpRequest.active_queue).includes(:cohort, :student, :owner, replies: :author).queue_order.to_a
    resolved = scoped(HelpRequest.status_resolved).includes(:cohort, :student, :owner, replies: :author).order(resolved_at: :desc).limit(RECENT_RESOLVED_LIMIT).to_a
    blocks = LearningDestination.help_request_blocks(active_requests + resolved)
    attention = AttentionProjection.new(now: @now, cohort_ids: @cohort_ids).call
    students = attention[:students]
    intervention_scope = Intervention.active
    intervention_scope = intervention_scope.joins(:enrollment).where(enrollments: { cohort_id: @cohort_ids }) if @cohort_ids
    active_interventions = intervention_scope.includes(enrollment: [ :user, :cohort ], owner: [], created_by: [], recovery_plan: []).recent_first.to_a
    due_interventions = active_interventions.count { |intervention| intervention.next_follow_up_at.present? && intervention.next_follow_up_at <= @now }
    recovery_scope = RecoveryPlan.status_active
    recovery_scope = recovery_scope.joins(:enrollment).where(enrollments: { cohort_id: @cohort_ids }) if @cohort_ids
    active_recovery_plans = recovery_scope.includes(enrollment: [ :user, :cohort ], owner: [], created_by: []).to_a
    # Each plan reports whether its owner can still teach the cohort (owner_valid).
    User.preload_assigned_cohort_ids(active_interventions.map(&:owner) + active_recovery_plans.map(&:owner))

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
      help_filter: help_filter_json,
      help_requests: active_requests.map { |request| HelpRequestSerializer.as_json(request, include_student: true, blocks: blocks) },
      recently_resolved: resolved.map { |request| HelpRequestSerializer.as_json(request, include_student: true, blocks: blocks) },
      students: students,
      interventions: active_interventions.map { |intervention| InterventionSerializer.as_json(intervention) },
      recovery_plans: active_recovery_plans.map { |plan| RecoveryPlanSerializer.as_json(plan) }
    }
  end

  private

  def scoped(relation)
    relation = relation.where(cohort_id: @cohort_ids) if @cohort_ids
    lesson_ids = filter_lesson_ids
    return relation unless lesson_ids

    blocks = ContentBlock.where(lesson_id: lesson_ids).select(:id)
    relation.where(context_type: :lesson, context_id: lesson_ids).or(relation.where(context_type: :exercise, context_id: blocks))
  end

  # The lessons the help filter covers, as a subquery, or nil without a filter.
  def filter_lesson_ids
    return Lesson.where(id: @lesson_filter).select(:id) if @lesson_filter
    return Lesson.where(module_id: @module_filter).select(:id) if @module_filter

    nil
  end

  # The filter's name for the page's chip, only for content on a curriculum one
  # of the scoped cohorts uses; anything else gets no name (it matches nothing
  # the viewer can see either).
  def help_filter_json
    return nil unless @lesson_filter || @module_filter

    curricula = @cohort_ids ? Cohort.where(id: @cohort_ids).select(:curriculum_id) : Cohort.select(:curriculum_id)
    if @lesson_filter
      lesson = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curricula }).find_by(id: @lesson_filter)
      { type: "lesson", id: @lesson_filter, name: lesson&.title }
    else
      mod = CurriculumModule.where(curriculum_id: curricula).find_by(id: @module_filter)
      { type: "module", id: @module_filter, name: mod&.name }
    end
  end

  def positive_id(value)
    number = Integer(value.to_s, 10, exception: false)
    number if number&.positive?
  end
end
