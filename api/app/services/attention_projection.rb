# One enrollment-scoped definition for staff home, cohort home and support.
# Clients may truncate this ordered queue for a preview, but never rank or qualify it.
class AttentionProjection
  INACTIVE_AFTER = 7.days
  INVITE_GRACE = 7.days

  def initialize(now: Time.current, cohort_ids: nil)
    @now = now
    @cohort_ids = cohort_ids
  end

  def call
    enrollments = Enrollment.active.joins(:cohort, :user).merge(Cohort.active).merge(User.not_archived)
    enrollments = enrollments.where(cohort_id: @cohort_ids) if @cohort_ids
    enrollments = enrollments.includes(:user, :cohort, :module_assignments, :lesson_assignments).to_a
    ids = enrollments.map(&:id)
    latest_ids = Submission.where(enrollment_id: ids).group(:enrollment_id, :content_block_id).maximum(:id).values
    @submissions = Submission.where(id: latest_ids).to_a.group_by(&:enrollment_id)
    @progress = Progress.completed.where(enrollment_id: ids).to_a.group_by(&:enrollment_id)
    @interventions = Intervention.active.where(enrollment_id: ids).order(:next_follow_up_at, :id).group_by(&:enrollment_id)
    @plans = RecoveryPlan.status_active.where(enrollment_id: ids).order(:next_check_in_at, :id).group_by(&:enrollment_id)
    requests = HelpRequest.active_queue.where(cohort_id: enrollments.map(&:cohort_id), student_id: enrollments.map(&:user_id)).queue_order.to_a
    @requests = requests.group_by { |request| [ request.student_id, request.cohort_id ] }
    @activity = ActivityEvent.where(cohort_id: enrollments.map(&:cohort_id), subject_user_id: enrollments.map(&:user_id))
      .where("actor_id = subject_user_id").where.not(event_type: %w[account_signed_in submission_graded])
      .group(:subject_user_id, :cohort_id).maximum(:created_at)
    rows = enrollments.map { |enrollment| row_for(enrollment) }
      .sort_by { |row| [ row[:priority], row[:full_name], row[:enrollment_id] ] }
    attention = rows.select { |row| row[:needs_attention] }
    {
      generated_at: @now,
      students: attention,
      enrollments: rows,
      summary: {
        student_count: attention.size,
        checked_enrollment_count: rows.size,
        ungraded_count: rows.sum { |row| row[:ungraded_count] },
        redo_count: rows.sum { |row| row[:redo_count] },
        reason_counts: attention.flat_map { |row| row[:reasons].map { |reason| reason[:code] } }.tally
      }
    }
  end

  private

  def row_for(enrollment)
    user = enrollment.user
    content = AssignedLearningContent.new(enrollment)
    assigned = content.completion_block_ids.to_set
    released = content.modules.flat_map do |mod|
      content.lessons_for(mod).select do |lesson|
        lesson.available?(enrollment.cohort, content.module_assignments[mod.id], content.lesson_assignments[lesson.id], on: LearningCalendar.today(at: @now))
      end.flat_map(&:completion_block_ids)
    end.to_set
    submissions = (@submissions[enrollment.id] || []).select { |item| assigned.include?(item.content_block_id) }
    progress = (@progress[enrollment.id] || []).select { |item| assigned.include?(item.content_block_id) }
    completed = progress.map(&:content_block_id).to_set
    unfinished = released - completed
    requests = @requests[[ user.id, enrollment.cohort_id ]] || []
    ungraded = submissions.select { |item| item.grade.nil? }.sort_by { |item| [ item.created_at, item.id ] }
    redos = submissions.select { |item| item.grade == "R" }.sort_by { |item| [ item.graded_at || item.created_at, item.id ] }
    interventions = @interventions[enrollment.id] || []
    due = interventions.select { |item| item.next_follow_up_at && item.next_follow_up_at <= @now }
    plans = @plans[enrollment.id] || []
    due_plans = plans.select { |plan| plan.next_check_in_at <= @now }
    # Sign-in/last-seen are account-wide and must not hide inactivity in another enrollment.
    recorded_activity = @activity[[ user.id, enrollment.cohort_id ]]
    recorded_activity = nil if recorded_activity && recorded_activity < enrollment.enrolled_at
    last_activity = [ progress.filter_map(&:completed_at).max, submissions.map(&:created_at).max, recorded_activity ].compact.max
    joined = enrollment.joined_at.present? && !user.invite_pending?
    learning_start = [ enrollment.joined_at, enrollment.enrolled_at, enrollment.cohort.start_date&.in_time_zone(LearningCalendar::TIMEZONE) ].compact.max
    inactive = joined && unfinished.any? && [ last_activity, learning_start ].compact.max <= @now - INACTIVE_AFTER
    context = "cohort_id=#{enrollment.cohort_id}&student_id=#{user.id}&enrollment_id=#{enrollment.id}"
    workspace = "/admin/cohorts/#{enrollment.cohort_id}/students/#{user.id}"
    native = "/staff/student/#{user.id}"
    reasons = []
    add = ->(code, label, type, records, timestamp, action_label, web, mobile) do
      reasons << { code: code, label: label, source_type: type, source_ids: records.map(&:id), since: timestamp,
                   action: { label: action_label, web_path: "#{web}?#{context}", native_path: "#{mobile}?#{context}", enrollment_id: enrollment.id } }
    end
    if requests.any?
      add.call("help_response", "#{requests.size} help request#{requests.one? ? '' : 's'} awaiting a staff response", "HelpRequest", requests, requests.first.created_at, "Respond to help", "/admin/help-requests/#{requests.first.id}", "/staff/support/#{requests.first.id}")
    end
    if ungraded.any?
      add.call("review", "#{ungraded.size} latest attempt#{ungraded.one? ? '' : 's'} awaiting review", "Submission", ungraded, ungraded.first.created_at, "Review work", "/admin/submissions/#{ungraded.first.id}", "/staff/submission/#{ungraded.first.id}")
    end
    if redos.any?
      since = redos.first.graded_at || redos.first.created_at
      age = [ ((@now - since) / 1.day).floor, 0 ].max
      add.call("waiting_on_learner", "Waiting on learner · #{redos.size} redo#{redos.one? ? '' : 's'} · #{age}d since feedback", "Submission", redos, since, "View redo feedback", "/admin/submissions/#{redos.first.id}", "/staff/submission/#{redos.first.id}")
    end
    if due.any?
      add.call("follow_up_due", "Intervention follow-up due", "Intervention", due, due.first.next_follow_up_at, "Follow up", "/admin/interventions/#{due.first.id}", "/staff/intervention/#{due.first.id}")
    end
    if due_plans.any?
      add.call("recovery_due", "Recovery check-in due", "RecoveryPlan", due_plans, due_plans.first.next_check_in_at, "Check in", "#{workspace}/support", native)
    end
    if inactive
      add.call("inactivity", "No learning activity in 7+ days · #{unfinished.size} released step#{unfinished.one? ? '' : 's'} unfinished", "Enrollment", [ enrollment ], last_activity || learning_start, "Consider a check-in", "#{workspace}/overview", native)
    end
    if joined && assigned.empty?
      add.call("setup", "No assigned learning · admin setup needed", "Enrollment", [ enrollment ], enrollment.enrolled_at, "Open learning setup", "#{workspace}/learning", native)
    end
    unless joined
      state = user.invite_state(now: @now)
      invited_at = enrollment.invited_at || enrollment.created_at
      if state == "failed" || state == "expired" || invited_at <= @now - INVITE_GRACE
        label = { "failed" => "Account invitation delivery failed", "expired" => "Account invitation expired" }.fetch(state, "Not joined · invited 7+ days ago")
        add.call("invitation_#{%w[failed expired].include?(state) ? state : 'not_joined'}", label, "Enrollment", [ enrollment ], invited_at, "Check invitation", "#{workspace}/access", native)
      end
    end
    {
      enrollment_id: enrollment.id, user_id: user.id, cohort_id: enrollment.cohort_id,
      full_name: user.full_name, email: user.email, cohort_name: enrollment.cohort.name,
      needs_attention: reasons.any?, reasons: reasons, next_action: reasons.first&.fetch(:action),
      priority: reasons.first ? reason_order(reasons.first[:code]) : 99,
      progress_percentage: assigned.any? ? (completed.size.to_f / assigned.size * 100).round(1) : 0,
      completed_blocks: completed.size, total_blocks: assigned.size,
      released_blocks: released.size, released_unfinished_blocks: unfinished.size,
      last_activity_at: last_activity, invited_at: enrollment.invited_at, joined_at: enrollment.joined_at,
      invite_state: user.invite_state(now: @now), invite_delivery_status: user.invite_delivery_status,
      help_request_count: requests.size, urgent_help_count: requests.count(&:urgency_urgent?),
      redo_count: redos.size, ungraded_count: ungraded.size, inactive: inactive,
      active_intervention_id: (due.first || interventions.first)&.id, intervention_status: (due.first || interventions.first)&.status,
      follow_up_due: due.any?, recovery_plan_id: (due_plans.first || plans.first)&.id, recovery_check_in_due: due_plans.any?,
      status: enrollment.status, enrollment_status: enrollment.status,
      assigned_module_count: content.modules.size, last_sign_in_at: user.last_sign_in_at, last_seen_at: user.last_seen_at,
      github_username: user.github_username,
      blocks_this_week: progress.count { |item| item.completed_at && item.completed_at >= @now - 7.days },
      submissions_this_week: submissions.count { |item| item.created_at >= @now - 7.days }
    }
  end

  def reason_order(code)
    %w[help_response review waiting_on_learner follow_up_due recovery_due inactivity setup invitation_failed invitation_expired invitation_not_joined].index(code)
  end
end
