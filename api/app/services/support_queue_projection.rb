class SupportQueueProjection
  INACTIVE_AFTER = 7.days
  RECENT_RESOLVED_LIMIT = 20

  def initialize(now: Time.current)
    @now = now
  end

  def call
    active_requests = HelpRequest.active_queue.includes(:cohort, :student, :owner).queue_order.to_a
    resolved = HelpRequest.status_resolved.includes(:cohort, :student, :owner).order(resolved_at: :desc).limit(RECENT_RESOLVED_LIMIT)
    students = student_candidates(active_requests)

    {
      generated_at: @now,
      summary: {
        open_help_count: active_requests.count(&:status_open?),
        acknowledged_help_count: active_requests.count(&:status_acknowledged?),
        urgent_help_count: active_requests.count(&:urgency_urgent?),
        student_count: students.size
      },
      help_requests: active_requests.map { |request| HelpRequestSerializer.as_json(request, include_student: true) },
      recently_resolved: resolved.map { |request| HelpRequestSerializer.as_json(request, include_student: true) },
      students: students
    }
  end

  private

  def student_candidates(active_requests)
    enrollments = Enrollment.active.joins(:cohort, :user)
      .merge(Cohort.active)
      .merge(User.not_archived)
      .includes(:user, :cohort, module_assignments: { curriculum_module: { lessons: :content_blocks } })
      .to_a
    user_ids = enrollments.map(&:user_id)
    requests_by_student_cohort = active_requests.group_by { |request| [ request.student_id, request.cohort_id ] }
    submissions = latest_submissions(user_ids).group_by(&:user_id)
    progresses = Progress.completed.where(user_id: user_ids).select(:user_id, :content_block_id, :completed_at).to_a.group_by(&:user_id)

    enrollments.filter_map do |enrollment|
      block_ids = enrollment.module_assignments.flat_map { |assignment| assignment.curriculum_module.lessons.flat_map(&:completion_block_ids) }.uniq
      assigned_block_ids = block_ids.to_set
      user_submissions = (submissions[enrollment.user_id] || []).select { |submission| assigned_block_ids.include?(submission.content_block_id) }
      user_progresses = (progresses[enrollment.user_id] || []).select { |progress| assigned_block_ids.include?(progress.content_block_id) }
      requests = requests_by_student_cohort[[ enrollment.user_id, enrollment.cohort_id ]] || []
      ungraded = user_submissions.count { |submission| submission.grade.nil? }
      redos = user_submissions.count { |submission| submission.grade == "R" }
      last_activity = [
        user_progresses.filter_map(&:completed_at).max,
        user_submissions.filter_map(&:created_at).max,
        enrollment.user.last_seen_at,
        enrollment.user.last_sign_in_at
      ].compact.max
      inactive = last_activity.nil? || last_activity < @now - INACTIVE_AFTER
      next if requests.empty? && ungraded.zero? && redos.zero? && !inactive

      completed = user_progresses.size
      total = block_ids.size
      {
        user_id: enrollment.user_id,
        cohort_id: enrollment.cohort_id,
        full_name: enrollment.user.full_name,
        email: enrollment.user.email,
        cohort_name: enrollment.cohort.name,
        progress_percentage: total.positive? ? (completed.to_f / total * 100).round(1) : 0,
        completed_blocks: completed,
        total_blocks: total,
        last_activity_at: last_activity,
        help_request_count: requests.size,
        urgent_help_count: requests.count(&:urgency_urgent?),
        redo_count: redos,
        ungraded_count: ungraded,
        inactive: inactive,
        priority: priority_for(requests: requests, redos: redos, ungraded: ungraded, inactive: inactive)
      }
    end.sort_by { |student| [ -student[:priority], student[:full_name] ] }
  end

  def latest_submissions(user_ids)
    ids = Submission.where(user_id: user_ids).group(:user_id, :content_block_id).maximum(:id).values
    Submission.where(id: ids).select(:id, :user_id, :content_block_id, :grade, :created_at).to_a
  end

  def priority_for(requests:, redos:, ungraded:, inactive:)
    requests.count(&:urgency_urgent?) * 10_000 + requests.size * 1_000 + redos * 100 + ungraded * 10 + (inactive ? 1 : 0)
  end
end
