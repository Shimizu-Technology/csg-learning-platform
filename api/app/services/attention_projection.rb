# One enrollment-scoped definition for staff home, cohort home and support.
# Clients may truncate this ordered queue for a preview, but never rank or qualify it.
class AttentionProjection
  INACTIVE_AFTER = 7.days
  INVITE_GRACE = 7.days

  # A learner's status in a few words: the top attention reason, "On track",
  # or the enrollment state when it is not active. The Students list, the
  # student page and peek cards all show this one label (T-3).
  STATUS_LABELS = {
    "help_response" => "Needs help",
    "review" => "Work to review",
    "waiting_on_learner" => "Redo open",
    "follow_up_due" => "Follow-up due",
    "recovery_due" => "Check-in due",
    "inactivity" => "Going quiet",
    "setup" => "Needs setup",
    "invitation_failed" => "Not joined",
    "invitation_expired" => "Not joined",
    "invitation_not_joined" => "Not joined"
  }.freeze
  ON_TRACK = "On track".freeze

  def self.status_label(enrollment, reasons)
    return enrollment.status.humanize unless enrollment.active?
    return STATUS_LABELS.fetch(reasons.first[:code], "Needs attention") if reasons.any?

    ON_TRACK
  end

  def initialize(now: Time.current, cohort_ids: nil, enrollment_scope: nil)
    @now = now
    @cohort_ids = cohort_ids
    @enrollment_scope = enrollment_scope
  end

  def call
    enrollments = (@enrollment_scope || Enrollment.active).joins(:cohort, :user).merge(User.not_archived)
    enrollments = enrollments.merge(Cohort.active) unless @enrollment_scope
    enrollments = enrollments.where(cohort_id: @cohort_ids) if @cohort_ids
    # preload, not includes: the joined-table filters above would turn includes into one
    # JOIN across enrollments x assignments x every lesson block (an OOM on production data).
    enrollments = enrollments.preload(:user).to_a
    # Counts and released work come from LearnerProgress, the learner's own
    # definition, loaded for every enrollment in a fixed number of queries.
    @learner_progress = LearnerProgress.for_all(enrollments, now: @now)
    ids = enrollments.map(&:id)
    latest_ids = Submission.latest_attempt_ids_for(Submission.where(enrollment_id: ids)).values
    @submissions = Submission.where(id: latest_ids).select(:id, :enrollment_id, :grade, :graded_at, :created_at).to_a.group_by(&:enrollment_id)
    @interventions = Intervention.active.where(enrollment_id: ids).order(:next_follow_up_at, :id).group_by(&:enrollment_id)
    @plans = RecoveryPlan.status_active.where(enrollment_id: ids).order(:next_check_in_at, :id).group_by(&:enrollment_id)
    requests = HelpRequest.active_queue.where(cohort_id: enrollments.map(&:cohort_id), student_id: enrollments.map(&:user_id)).queue_order.order(:id).to_a
    @requests = requests.group_by { |request| [ request.student_id, request.cohort_id ] }
    # The one "last active" (LearnerActivity): learning activity in this enrollment only.
    @last_active = LearnerActivity.for_all(enrollments)
    rows = enrollments.map { |enrollment| row_for(enrollment) }
      .sort_by { |row| [ row[:priority], row[:urgent_help_count].positive? ? 0 : 1, row[:reasons].first&.fetch(:since) || @now, row[:enrollment_id] ] }
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
    learner = @learner_progress.fetch(enrollment.id)
    content = learner.content
    assigned = content.completion_block_ids
    overall = learner.overall
    released = learner.released
    unfinished = released[:unfinished]
    # Assignment removal preserves submitted evidence and its pending staff review.
    submissions = @submissions[enrollment.id] || []
    requests = @requests[[ user.id, enrollment.cohort_id ]] || []
    ungraded = submissions.select { |item| item.grade.nil? }.sort_by { |item| [ item.created_at, item.id ] }
    redos = submissions.select { |item| item.grade == "R" }.sort_by { |item| [ item.graded_at || item.created_at, item.id ] }
    interventions = @interventions[enrollment.id] || []
    due = interventions.select { |item| item.next_follow_up_at && item.next_follow_up_at <= @now }
    plans = @plans[enrollment.id] || []
    due_plans = plans.select { |plan| plan.next_check_in_at <= @now }
    last_activity = @last_active[enrollment.id]
    joined = enrollment.joined_at.present? && !user.invite_pending?
    learning_start = [ enrollment.joined_at, enrollment.enrolled_at, enrollment.cohort.start_date&.in_time_zone(LearningCalendar::TIMEZONE) ].compact.max
    inactive = joined && unfinished.positive? && [ last_activity, learning_start ].compact.max <= @now - INACTIVE_AFTER
    context = "cohort_id=#{enrollment.cohort_id}&student_id=#{user.id}&enrollment_id=#{enrollment.id}"
    workspace = "/admin/cohorts/#{enrollment.cohort_id}/students/#{user.id}"
    native = "/staff/student/#{user.id}"
    reasons = []
    add = ->(code, label, type, records, timestamp, action_label, web, mobile, web_handoff = false) do
      reasons << { code: code, label: label, source_type: type, source_ids: records.map(&:id), since: timestamp,
                   action: { label: action_label, web_path: "#{web}#{web.include?("?") ? "&" : "?"}#{context}", native_path: "#{mobile}?#{context}", web_handoff: web_handoff, enrollment_id: enrollment.id } }
    end
    if requests.any?
      add.call("help_response", (requests.any?(&:urgency_urgent?) ? "Urgent help request · #{requests.size} awaiting a staff response" : "#{requests.size} help request#{requests.one? ? '' : 's'} awaiting a staff response"), "HelpRequest", requests, requests.first.created_at, "Respond to help", "/admin/help-requests/#{requests.first.id}", "/staff/support/#{requests.first.id}")
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
      add.call("recovery_due", "Recovery check-in due", "RecoveryPlan", due_plans, due_plans.first.next_check_in_at, "Check in", "#{workspace}/support?plan_id=#{due_plans.first.id}", native, true)
    end
    if inactive
      add.call("inactivity", "No learning activity in 7+ days · #{unfinished} released step#{unfinished == 1 ? '' : 's'} unfinished", "Enrollment", [ enrollment ], last_activity || learning_start, "Consider a check-in", "#{workspace}/overview", native)
    end
    if joined && assigned.empty?
      add.call("setup", "No assigned learning · admin setup needed", "Enrollment", [ enrollment ], enrollment.enrolled_at, "Open learning setup", AttentionDestinations.learning_setup(enrollment), native, true)
    end
    unless joined
      state = user.invite_state(now: @now)
      invited_at = enrollment.invited_at || enrollment.created_at
      if state == "failed" || state == "expired" || invited_at <= @now - INVITE_GRACE
        label = { "failed" => "Account invitation delivery failed", "expired" => "Account invitation expired" }.fetch(state, "Not joined · invited 7+ days ago")
        add.call("invitation_#{%w[failed expired].include?(state) ? state : 'not_joined'}", label, "Enrollment", [ enrollment ], invited_at, "Check invitation", "#{workspace}/access", native)
      end
    end
    # Roster metrics remain available for past/upcoming cohorts and paused learners.
    # Those records do not enter the current attention queue.
    reasons.clear unless enrollment.active? && enrollment.cohort.active?
    {
      enrollment_id: enrollment.id, user_id: user.id, cohort_id: enrollment.cohort_id,
      full_name: user.full_name, email: user.email, cohort_name: enrollment.cohort.name,
      needs_attention: reasons.any?, reasons: reasons, next_action: reasons.first&.fetch(:action),
      status_label: self.class.status_label(enrollment, reasons),
      priority: reasons.first ? reason_order(reasons.first[:code]) : 99,
      progress_percentage: overall[:percentage],
      completed_blocks: overall[:completed], total_blocks: overall[:total],
      completed_lessons: overall[:completed_lessons], total_lessons: overall[:total_lessons],
      released_blocks: released[:total], released_unfinished_blocks: unfinished,
      last_activity_at: last_activity, invited_at: enrollment.invited_at, joined_at: enrollment.joined_at,
      invite_state: user.invite_state(now: @now), invite_delivery_status: user.invite_delivery_status,
      help_request_count: requests.size, urgent_help_count: requests.count(&:urgency_urgent?),
      redo_count: redos.size, ungraded_count: ungraded.size, inactive: inactive,
      active_intervention_id: (due.first || interventions.first)&.id, intervention_status: (due.first || interventions.first)&.status,
      follow_up_due: due.any?, recovery_plan_id: (due_plans.first || plans.first)&.id, recovery_check_in_due: due_plans.any?,
      status: enrollment.status, enrollment_status: enrollment.status,
      assigned_module_count: content.modules.size, last_sign_in_at: user.last_sign_in_at, last_seen_at: user.last_seen_at,
      github_username: user.github_username,
      blocks_this_week: learner.steps_completed_since(@now - 7.days),
      submissions_this_week: submissions.count { |item| item.created_at >= @now - 7.days }
    }
  end

  def reason_order(code)
    %w[help_response review waiting_on_learner follow_up_due recovery_due inactivity setup invitation_failed invitation_expired invitation_not_joined].index(code)
  end
end
