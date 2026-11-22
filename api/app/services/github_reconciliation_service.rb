# Hourly reconciliation for opted-in GitHub App repository bindings (X-6.6).
#
# Runs OUTSIDE ScheduledTick's global advisory-lock transaction using durable
# per-binding claim leases (claim_token + claimed_until), bounded by both a
# binding cap and a wall-clock time budget. Zero DB locks are held across
# external GitHub HTTP calls.
#
# Workflow per claimed binding:
# 1. Verify repository & resolve branch head to an exact commit SHA FIRST.
# 2. Import exact-SHA exercise files via GithubSubmittedRevisionSync (skipping
#    unchanged head SHA when no new exercises need sync, respecting module
#    assignments & submission_type_for, and honoring activated_at so historical
#    cohorts never back-crawl pre-activation work).
# 3. Replay & attach eligible `staged` GithubWebhookDelivery rows (check_run
#    prioritized by attachable SHAs, push, and ambiguous installation revocations
#    re-verified live, never prematurely settling deliveries still needed by
#    sibling eligible bindings).
# 4. Refresh due/pending check runs per unique commit SHA via GithubCheckRunMerger.
# 5. Evaluate pure grade suggestions via GithubGradeSuggestionEvaluator (NEVER
#    writing Submission.grade), including catch-up for live webhooks, mid-binding
#    aborts, and active policy version bumps.
# 6. Finalize GithubReconciliationState guarded by claim_token with fair
#    round-robin scheduling and bounded exponential backoff.
class GithubReconciliationService
  class IncompleteCheckListError < GithubAppClient::Error
    def transient? = true
  end

  class RetryableSyncError < GithubAppClient::Error
    def transient? = true
  end

  MAX_BINDINGS = 15
  DEFAULT_MAX_DURATION = 20.seconds
  CLAIM_LEASE = 5.minutes
  RECONCILE_INTERVAL = 1.hour
  BACKOFFS = [ 15.minutes, 30.minutes, 1.hour, 2.hours, 4.hours ].freeze
  MAX_RETRY_AFTER = 24.hours
  MAX_STAGED_DELIVERIES_PER_BINDING = 50
  MAX_CHECK_REFRESH_SUBMISSIONS_PER_BINDING = 25
  MAX_CHECK_RUN_PAGES = 10
  REVOCATION_STATUSES = [ 401, 403, 404, 422 ].freeze
  SIZE_LIMIT_WARNING = "One or more exercise files exceeded the 256 KiB capture limit and were not imported".freeze

  def self.enabled_for?(cohort, school: nil)
    return false unless cohort.present?

    features = FeatureSwitches.for(cohort: cohort, school: school)
    features["github_app"] == true && features["github_reconciliation"] == true
  end

  def self.cohort_active_on?(cohort, now)
    return false unless cohort.present?
    return true if cohort.status == "active"

    school_today = now.in_time_zone(Rails.application.config.x.school.time_zone).to_date
    cohort.upcoming? && cohort.start_date.present? && cohort.start_date <= school_today
  end

  # Strictly read-only preview for `scheduled:tick` dry-run: zero DB writes and
  # zero external GitHub HTTP calls.
  def self.preview(now = Time.current, max_bindings: MAX_BINDINGS)
    school = FeatureSwitches.school(read_only: true)
    unless school["github_app"] == true && school["github_reconciliation"] == true
      return { would_claim: 0, staged_deliveries: 0, enabled: false }
    end

    opted_in_cohort_ids = opted_in_active_cohort_ids(school: school, now: now)
    if opted_in_cohort_ids.empty?
      return { would_claim: 0, staged_deliveries: 0, enabled: true }
    end

    candidates = due_bindings_relation(cohort_ids: opted_in_cohort_ids, now: now)
      .includes(:github_app_installation, :curriculum_module, :github_reconciliation_state, enrollment: [ :cohort, :user ])
      .to_a
      .select { |binding| binding_eligible?(binding, school: school, now: now) }

    repo_ids = candidates.filter_map(&:repository_id).uniq
    inst_ids = candidates.filter_map { |b| b.github_app_installation&.installation_id }.uniq
    staged_count = count_staged_deliveries(repo_ids: repo_ids, installation_ids: inst_ids)

    {
      would_claim: [ candidates.size, max_bindings ].min,
      staged_deliveries: staged_count,
      enabled: true
    }
  end

  def self.opted_in_active_cohort_ids(school:, now:)
    school_today = now.in_time_zone(Rails.application.config.x.school.time_zone).to_date
    Cohort.active(on: school_today)
      .where("settings->'features'->>'github_app' = 'true' AND settings->'features'->>'github_reconciliation' = 'true'")
      .select { |cohort| enabled_for?(cohort, school: school) }
      .map(&:id)
  end

  # Push user/identity/cohort/curriculum eligibility checks into SQL so
  # ineligible rows cannot crowd out healthy bindings behind pre-filter limits.
  def self.due_bindings_relation(cohort_ids:, now:)
    GithubRepositoryBinding
      .joins(:github_app_installation, enrollment: [ :user, :cohort ])
      .left_outer_joins(:curriculum_module, :github_reconciliation_state)
      .where(
        verification_state: "verified",
        github_app_installations: { connection_state: "connected" },
        enrollments: { cohort_id: cohort_ids, status: Enrollment.statuses.fetch("active") },
        users: { archived_at: nil }
      )
      .where.not(repository_id: nil)
      .where("LEFT(users.clerk_id, 8) <> ?", "pending_")
      .where("users.github_user_id IS NOT NULL AND users.github_verified_login IS NOT NULL AND users.github_verified_at IS NOT NULL")
      .where("github_repository_bindings.github_user_id = users.github_user_id")
      .where("LOWER(github_repository_bindings.github_username) = LOWER(users.github_verified_login)")
      .where("github_app_installations.cohort_id = enrollments.cohort_id")
      .where("github_repository_bindings.curriculum_module_id IS NULL OR modules.curriculum_id = cohorts.curriculum_id")
      .where("enrollments.access_expires_at IS NULL OR enrollments.access_expires_at > ?", now)
      .where("github_reconciliation_states.claimed_until IS NULL OR github_reconciliation_states.claimed_until <= ?", now)
      .where("github_reconciliation_states.next_reconcile_at IS NULL OR github_reconciliation_states.next_reconcile_at <= ?", now)
      .order(Arel.sql("github_reconciliation_states.next_reconcile_at ASC NULLS FIRST, github_reconciliation_states.last_reconciled_at ASC NULLS FIRST, github_repository_bindings.id ASC"))
  end

  def self.binding_eligible?(binding, school:, now:)
    installation = binding.github_app_installation
    enrollment = binding.enrollment
    cohort = enrollment&.cohort
    user = enrollment&.user
    return false unless binding.verification_state == "verified" && binding.repository_id.present?
    return false unless installation&.connection_state == "connected" && installation.cohort_id == enrollment&.cohort_id
    return false unless enrollment && enrollment.status == "active" && (enrollment.access_expires_at.nil? || enrollment.access_expires_at > now)
    return false unless user.present? && !user.archived? && !user.invite_pending?
    return false unless binding.identity_current?
    return false unless cohort_active_on?(cohort, now) && enabled_for?(cohort, school: school)
    return false if binding.curriculum_module && binding.curriculum_module.curriculum_id != cohort.curriculum_id

    true
  end

  def self.count_staged_deliveries(repo_ids:, installation_ids:)
    return 0 if repo_ids.empty? && installation_ids.empty?

    scopes = []
    if repo_ids.any?
      scopes << GithubWebhookDelivery.staged.where(event: %w[check_run push], repository_id: repo_ids)
    end
    if installation_ids.any?
      scopes << GithubWebhookDelivery.staged.where(event: %w[installation installation_repositories], installation_id: installation_ids)
    end
    combined = scopes.reduce { |acc, rel| acc.or(rel) }
    combined.count
  end
  private_class_method :count_staged_deliveries

  def initialize(
    client: nil,
    max_bindings: MAX_BINDINGS,
    max_duration: DEFAULT_MAX_DURATION,
    monotonic: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) },
    clock: -> { Time.current }
  )
    @client = client
    @max_bindings = max_bindings
    @max_duration = max_duration
    @monotonic = monotonic
    @clock = clock
  end

  def call(now: Time.current, metrics: {})
    metrics[:claimed] ||= 0
    metrics[:sent] ||= 0
    metrics[:failed] ||= 0
    metrics[:revisions_synced] ||= 0
    metrics[:webhooks_replayed] ||= 0
    metrics[:checks_refreshed] ||= 0
    metrics[:suggestions_evaluated] ||= 0

    school = FeatureSwitches.school(read_only: true)
    return metrics unless school["github_app"] == true && school["github_reconciliation"] == true

    opted_in_cohort_ids = self.class.opted_in_active_cohort_ids(school: school, now: now)
    return metrics if opted_in_cohort_ids.empty?

    deadline = @max_duration ? @monotonic.call + @max_duration : nil
    candidate_ids = self.class.due_bindings_relation(cohort_ids: opted_in_cohort_ids, now: now)
      .limit(@max_bindings * 3)
      .pluck(:id)

    claimed_count = 0
    candidate_ids.each do |binding_id|
      break if claimed_count >= @max_bindings
      break if deadline && @monotonic.call >= deadline

      outcome = reconcile_binding!(binding_id, now: now, school: school, deadline: deadline, metrics: metrics)
      break if outcome == :budget_exceeded
      next if %i[skipped in_flight not_due stale_claim].include?(outcome)

      claimed_count += 1
      metrics[:claimed] += 1
      case outcome
      when :ok then metrics[:sent] += 1
      when :backoff, :failed then metrics[:failed] += 1
      end
    end

    metrics
  end

  def reconcile_binding!(binding_or_id, now: Time.current, school: nil, deadline: nil, metrics: {})
    binding_id = binding_or_id.is_a?(GithubRepositoryBinding) ? binding_or_id.id : binding_or_id
    return :budget_exceeded if deadline && @monotonic.call >= deadline

    resolved_school = school || FeatureSwitches.school(read_only: true)
    claim = claim_binding!(binding_id, now: now, school: resolved_school)
    return claim unless claim.is_a?(Hash)

    execute_reconciliation!(
      claim: claim,
      now: now,
      school: resolved_school,
      deadline: deadline,
      metrics: metrics
    )
  end

  private

  def effective_now(reference_now)
    current = @clock.call
    reference_now && reference_now > current ? reference_now : current
  end

  def check_budget!(deadline)
    return unless deadline

    raise GithubAppClient::BudgetExceeded, "GitHub reconciliation budget exhausted" if @monotonic.call >= deadline
  end

  def clamped_request_timeout(deadline)
    return nil unless deadline

    remaining = deadline - @monotonic.call
    raise GithubAppClient::BudgetExceeded, "GitHub reconciliation budget exhausted" if remaining <= 0

    [ remaining, GithubAppClient::DEFAULT_TIMEOUT.to_f ].min
  end

  # Short DB transaction with zero HTTP calls. Acquires a durable lease on the
  # binding's GithubReconciliationState row.
  def claim_binding!(binding_id, now:, school:)
    claim_time = effective_now(now)
    binding = GithubRepositoryBinding
      .includes(:github_app_installation, :curriculum_module, enrollment: [ :cohort, :user ])
      .find_by(id: binding_id)
    return :skipped unless binding && self.class.binding_eligible?(binding, school: school, now: claim_time)

    state = find_or_initialize_state!(binding, claim_time: claim_time)
    return :skipped unless state

    state.with_lock do
      binding = GithubRepositoryBinding
        .includes(:github_app_installation, :curriculum_module, enrollment: [ :cohort, :user ])
        .find_by(id: binding_id)
      return :skipped unless binding && self.class.binding_eligible?(binding, school: school, now: claim_time)
      return :in_flight if state.claimed?(claim_time)
      return :not_due if state.next_reconcile_at.present? && state.next_reconcile_at > claim_time

      claim_token = SecureRandom.hex(16)
      state.update!(
        claim_token: claim_token,
        claimed_until: claim_time + CLAIM_LEASE
      )
      {
        binding: binding,
        state: state,
        claim_token: claim_token,
        activated_at: state.activated_at,
        last_head_sha: state.last_head_sha,
        last_reconciled_at: state.last_reconciled_at
      }
    end
  rescue ActiveRecord::RecordNotFound
    :stale_claim
  end

  def find_or_initialize_state!(binding, claim_time:)
    existing = GithubReconciliationState.find_by(github_repository_binding_id: binding.id)
    return existing if existing

    activated_at = initial_activated_at(binding, claim_time: claim_time)
    GithubReconciliationState.transaction(requires_new: true) do
      GithubReconciliationState.create!(
        github_repository_binding_id: binding.id,
        activated_at: activated_at,
        last_status: "idle"
      )
    end
  rescue ActiveRecord::RecordNotUnique
    GithubReconciliationState.find_by(github_repository_binding_id: binding.id)
  end

  # Respects activation boundary: if a binding was just verified within the last
  # reconciliation interval (e.g. a newly set-up cohort before its first hourly
  # tick), anchor at its verification time so work pushed in the first hour is
  # picked up; for older historical bindings, anchor at claim_time so enabling
  # reconciliation never back-crawls pre-activation commits or old cohorts.
  def initial_activated_at(binding, claim_time:)
    verified_at = binding.verified_at
    if verified_at.present? && verified_at <= claim_time && verified_at >= claim_time - RECONCILE_INTERVAL
      verified_at
    else
      claim_time
    end
  end

  def execute_reconciliation!(claim:, now:, school:, deadline:, metrics:)
    binding = claim.fetch(:binding)
    state = claim.fetch(:state)
    claim_token = claim.fetch(:claim_token)
    enrollment = binding.enrollment
    cohort = enrollment.cohort
    features = FeatureSwitches.for(cohort: cohort, school: school)
    client = @client || GithubAppClient.new
    access = GithubRepositoryAccess.new(binding, client: client)
    request_started_at = effective_now(now)
    step1_verified = false

    # Step 1: Verify repository & resolve branch head to an exact commit SHA FIRST
    # (NO DB locks held across GitHub HTTP!).
    repository = access.repository!(
      timeout: clamped_request_timeout(deadline),
      deadline: deadline,
      monotonic: @monotonic
    )
    step1_verified = true

    head = resolve_head_commit(
      client: client,
      installation: binding.github_app_installation,
      repository: repository,
      deadline: deadline
    )
    head_sha = head&.dig(:commit_hash)
    head_branch = head&.dig(:branch)
    head_committed_at = head&.dig(:committed_at)

    # Activation boundary: remains active across Tick 2+ while the branch stays
    # on a pre-activation baseline SHA with no post-activation submission at it.
    pre_activation_head = head_sha.present? &&
      head_committed_at.present? &&
      head_committed_at < claim[:activated_at] &&
      (claim[:last_head_sha].nil? ||
        (claim[:last_head_sha].casecmp?(head_sha) &&
          !Submission.where(enrollment_id: enrollment.id, commit_sha: head_sha)
            .where("created_at >= ?", claim[:activated_at]).exists?))

    submissions_to_evaluate = Set.new
    covered_scope = covered_modules_for(binding)
    covered_modules = covered_scope[:modules]
    lesson_restrictions = covered_scope[:lesson_restrictions]

    # Step 2: Import exact-SHA exercise files (skipping unchanged SHA when no new
    # exercises need sync, respecting module assignments & submission_type_for).
    sync_warning = nil
    step2_succeeded = false
    if head_sha.present? && !pre_activation_head && features["github_sync"] == true && covered_modules.any?
      check_budget!(deadline)
      sync_result = sync_exact_sha_files!(
        access: access,
        binding: binding,
        repository: repository,
        client: client,
        head_sha: head_sha,
        head_branch: head_branch,
        covered_modules: covered_modules,
        lesson_restrictions: lesson_restrictions,
        features: features,
        school: school,
        claim: claim,
        now: now,
        request_started_at: request_started_at,
        deadline: deadline
      )
      step2_succeeded = true
      sync_warning = sync_result[:warning_error]
      metrics[:revisions_synced] = (metrics[:revisions_synced] || 0) + sync_result[:synced_ids].size
      submissions_to_evaluate.merge(sync_result[:synced_ids])
    else
      step2_succeeded = head_sha.present?
    end

    # Step 3: Replay & attach eligible `staged` GithubWebhookDelivery rows.
    check_budget!(deadline)
    replayed = replay_staged_webhooks!(
      binding: binding,
      covered_modules: covered_modules,
      head_sha: head_sha,
      head_branch: head_branch,
      step2_succeeded: step2_succeeded && !pre_activation_head,
      activated_at: claim[:activated_at],
      request_started_at: request_started_at,
      now: now,
      school: school,
      deadline: deadline
    )
    metrics[:webhooks_replayed] = (metrics[:webhooks_replayed] || 0) + replayed[:replayed_count]
    submissions_to_evaluate.merge(replayed[:attached_submission_ids])

    # Step 4: Refresh due/pending check runs for post-activation current-attempt
    # submissions (deduplicated per unique commit SHA, respecting budget).
    active_head_sha = pre_activation_head ? nil : head_sha
    if features["github_sync"] == true
      check_budget!(deadline)
      refreshed_ids = refresh_due_check_runs!(
        binding: binding,
        repository: repository,
        client: client,
        covered_modules: covered_modules,
        head_sha: active_head_sha,
        activated_at: claim[:activated_at],
        now: now,
        deadline: deadline
      )
      metrics[:checks_refreshed] = (metrics[:checks_refreshed] || 0) + refreshed_ids.size
      submissions_to_evaluate.merge(refreshed_ids)
    end

    # Step 5: Evaluate pure grade suggestions (NEVER writes Submission.grade!).
    # Also catches up submissions whose checks completed via live webhooks,
    # whose prior tick aborted mid-binding, or whose active policy version bumped.
    if features["github_grade_suggestions"] == true
      check_budget!(deadline)
      catch_up_ids = submissions_needing_grade_suggestion(
        binding: binding,
        covered_modules: covered_modules,
        head_sha: active_head_sha,
        activated_at: claim[:activated_at]
      )
      submissions_to_evaluate.merge(catch_up_ids)

      if submissions_to_evaluate.any?
        evaluated_count = evaluate_grade_suggestions!(
          submission_ids: submissions_to_evaluate.to_a,
          now: now,
          deadline: deadline
        )
        metrics[:suggestions_evaluated] = (metrics[:suggestions_evaluated] || 0) + evaluated_count
      end
    end

    # Step 6: Finalize state guarded by claim_token.
    finalize_success!(
      state: state,
      claim_token: claim_token,
      head_sha: head_sha,
      request_started_at: request_started_at,
      warning_error: sync_warning,
      now: now
    )
  rescue GithubAppClient::BudgetExceeded
    release_claim_on_budget!(state: state, claim_token: claim_token)
  rescue GithubRepositoryAccess::BindingChanged => error
    record_failure!(
      state: state,
      claim_token: claim_token,
      error: error,
      now: now,
      permanent: true
    )
  rescue GithubAppClient::Error => error
    if step1_verified && !error.transient? && REVOCATION_STATUSES.include?(error.status)
      access&.fail_current_verification!(error)
    end
    binding_failed = GithubRepositoryBinding.where(id: binding.id, verification_state: "failed").exists?
    permanent = (!error.transient? && REVOCATION_STATUSES.include?(error.status)) || binding_failed
    settle_revoked_staged_webhooks!(binding: binding, now: now) if permanent
    record_failure!(
      state: state,
      claim_token: claim_token,
      error: error,
      now: now,
      permanent: permanent
    )
  rescue Enrollment::StaleLearningWrite => error
    record_failure!(
      state: state,
      claim_token: claim_token,
      error: error,
      now: now,
      permanent: false
    )
  rescue StandardError => error
    Rails.logger.warn("GitHub reconciliation failed for binding #{binding.id}: #{error.class.name}")
    record_failure!(
      state: state,
      claim_token: claim_token,
      error: error,
      now: now,
      permanent: false
    )
  end

  def resolve_head_commit(client:, installation:, repository:, deadline:)
    client.default_branch_head(
      installation: installation,
      repository: repository,
      timeout: clamped_request_timeout(deadline),
      deadline: deadline,
      monotonic: @monotonic
    )
  rescue GithubAppClient::Error => error
    return nil if error.message == "GitHub repository has no submitted commit"

    raise
  end

  def covered_modules_for(binding)
    enrollment = binding.enrollment
    cohort = enrollment.cohort
    candidates = if binding.curriculum_module_id.present?
      [ binding.curriculum_module ]
    else
      overridden_ids = GithubRepositoryBinding
        .where(enrollment_id: binding.enrollment_id)
        .where.not(curriculum_module_id: nil)
        .pluck(:curriculum_module_id)
      scope = cohort.curriculum.modules.order(:position, :id)
      overridden_ids.any? ? scope.where.not(id: overridden_ids).to_a : scope.to_a
    end

    has_defaults_snapshot = cohort.content_defaults.is_a?(Hash) && !cohort.alumni?
    assigned_module_ids = enrollment.module_assignments.pluck(:module_id).to_set
    lesson_ids_by_module = enrollment.lesson_assignments
      .joins(:lesson)
      .pluck("lessons.module_id", :lesson_id)
      .group_by(&:first)
      .transform_values { |pairs| pairs.map(&:last).to_set }

    modules = []
    lesson_restrictions = {}
    candidates.each do |mod|
      default_entry = has_defaults_snapshot ? cohort.content_defaults[mod.id.to_s] : nil
      default_assigned = !has_defaults_snapshot || (default_entry.is_a?(Hash) && default_entry["assigned"] == true)
      if !default_assigned && !assigned_module_ids.include?(mod.id)
        assigned_lessons = lesson_ids_by_module[mod.id]
        next if assigned_lessons.blank?

        lesson_restrictions[mod.id] = assigned_lessons
      end
      modules << mod
    end

    { modules: modules, lesson_restrictions: lesson_restrictions }
  end

  def sync_exact_sha_files!(access:, binding:, repository:, client:, head_sha:, head_branch:, covered_modules:, lesson_restrictions:, features:, school:, claim:, now:, request_started_at:, deadline:)
    enrollment = binding.enrollment
    cohort = enrollment.cohort
    user = enrollment.user
    module_ids = covered_modules.map(&:id)

    all_blocks = ContentBlock
      .joins(:lesson)
      .where(lessons: { module_id: module_ids, archived_at: nil })
      .where(block_type: [ :exercise, :code_challenge ])
      .where.not(filename: [ nil, "" ])
      .includes(lesson: :curriculum_module)
      .to_a
      .select do |block|
        restricted_lessons = lesson_restrictions[block.lesson.module_id]
        next false if restricted_lessons && !restricted_lessons.include?(block.lesson_id)

        block.submission_type_for(enrollment, school: school) == "prework_github_sync"
      end

    open_blocks = all_blocks.reject do |block|
      SubmissionWindowStatus.closed_for_lesson?(cohort: cohort, lesson: block.lesson, enrollment: enrollment, at: now)
    end
    return { synced_ids: [], warning_error: nil } if open_blocks.empty?

    sha_unchanged = claim[:last_head_sha].present? && claim[:last_head_sha].casecmp?(head_sha)
    if sha_unchanged
      last_reconciled = claim[:last_reconciled_at]
      has_new_exercises = last_reconciled.nil? ||
        open_blocks.any? { |block| block.created_at > last_reconciled || block.updated_at > last_reconciled }
      return { synced_ids: [], warning_error: nil } unless has_new_exercises
    end

    filenames = open_blocks.filter_map { |b| b.filename&.strip }.uniq
    workflow_paths = if features["github_grade_suggestions"] == true
      ExerciseCheckPolicy.active
        .where(content_block_id: open_blocks.map(&:id))
        .where.not(expected_workflow_path: [ nil, "" ])
        .distinct
        .pluck(:expected_workflow_path)
        .sort
    else
      []
    end

    repo_data = client.files_at_commit(
      installation: binding.github_app_installation,
      repository: repository,
      sha: head_sha,
      branch: head_branch,
      filenames: filenames,
      workflow_paths: workflow_paths,
      timeout: clamped_request_timeout(deadline),
      deadline: deadline,
      monotonic: @monotonic
    )
    return { synced_ids: [], warning_error: nil } if repo_data[:error].present?

    synced_ids = []
    size_limit_exceeded = false
    blocks_by_module = open_blocks.group_by { |block| block.lesson.module_id }
    covered_modules.each do |mod|
      check_budget!(deadline)
      mod_blocks = blocks_by_module[mod.id]
      next if mod_blocks.blank?

      errors = []
      GithubSubmittedRevisionSync.new(access: access, binding: binding, repository: repository).call(
        user: user,
        enrollment: enrollment,
        curriculum_module_id: mod.id,
        exercise_blocks: mod_blocks,
        repo_data: repo_data,
        errors: errors,
        request_started_at: request_started_at,
        synced_submission_ids: synced_ids
      )
      if errors.any? { |msg| msg.include?("exercise configuration changed during sync") }
        raise RetryableSyncError, "Exercise configuration changed during reconciliation; retrying on next run"
      end
      if errors.any? { |msg| msg.include?("exceeds the 256 KiB capture limit") }
        size_limit_exceeded = true
      end
    end

    { synced_ids: synced_ids, warning_error: size_limit_exceeded ? SIZE_LIMIT_WARNING : nil }
  end

  def replay_staged_webhooks!(binding:, covered_modules:, head_sha:, head_branch:, step2_succeeded:, activated_at:, request_started_at:, now:, school:, deadline:)
    installation = binding.github_app_installation
    repo_id = binding.repository_id
    inst_id = installation.installation_id
    handled_at = effective_now(now)

    # Prioritize attachable check_run deliveries (matching head_sha or any latest
    # submission commit_sha for this binding) so >50 intermediate non-head
    # deliveries cannot head-of-line block attachable work.
    attachable_shas = attachable_shas_for_binding(binding: binding, covered_modules: covered_modules, head_sha: head_sha)
    repo_deliveries = []
    if attachable_shas.any?
      repo_deliveries.concat(
        GithubWebhookDelivery.staged
          .where(event: "check_run", repository_id: repo_id, installation_id: inst_id)
          .where("LOWER(head_sha) IN (?)", attachable_shas)
          .order(:received_at, :id)
          .limit(MAX_STAGED_DELIVERIES_PER_BINDING)
          .to_a
      )
    end
    remaining_slots = MAX_STAGED_DELIVERIES_PER_BINDING - repo_deliveries.size
    if remaining_slots.positive?
      remainder = GithubWebhookDelivery.staged
        .where(event: %w[check_run push], repository_id: repo_id, installation_id: inst_id)
        .order(:received_at, :id)
        .limit(remaining_slots)
      remainder = remainder.where.not(id: repo_deliveries.map(&:id)) if repo_deliveries.any?
      repo_deliveries.concat(remainder.to_a)
    end

    inst_deliveries = GithubWebhookDelivery.staged
      .where(event: %w[installation installation_repositories], installation_id: inst_id)
      .order(:received_at, :id)
      .limit(MAX_STAGED_DELIVERIES_PER_BINDING)
      .to_a

    replayed_count = 0
    attached_submission_ids = Set.new

    repo_deliveries.each do |delivery|
      check_budget!(deadline)
      result = replay_one_repo_delivery!(
        delivery: delivery,
        binding: binding,
        head_sha: head_sha,
        head_branch: head_branch,
        step2_succeeded: step2_succeeded,
        activated_at: activated_at,
        handled_at: handled_at,
        school: school
      )
      replayed_count += 1 if result[:settled]
      attached_submission_ids.merge(result[:attached_submission_ids])
    end

    inst_deliveries.each do |delivery|
      check_budget!(deadline)
      settled = replay_one_revocation_delivery!(
        delivery: delivery,
        binding: binding,
        request_started_at: request_started_at,
        handled_at: handled_at
      )
      replayed_count += 1 if settled
    end

    { replayed_count: replayed_count, attached_submission_ids: attached_submission_ids }
  end

  def attachable_shas_for_binding(binding:, covered_modules:, head_sha:)
    shas = []
    shas << head_sha.downcase if head_sha.present?
    module_ids = covered_modules.map(&:id)
    if module_ids.any?
      shas.concat(
        Submission.where(enrollment_id: binding.enrollment_id)
          .latest_attempts
          .joins(content_block: :lesson)
          .where(lessons: { module_id: module_ids })
          .where.not(commit_sha: [ nil, "" ])
          .distinct
          .pluck(:commit_sha)
          .map(&:downcase)
      )
    end
    shas.uniq
  end

  # Lock order matches GithubWebhookReceiver: delivery -> enrollment -> submission.
  def replay_one_repo_delivery!(delivery:, binding:, head_sha:, head_branch:, step2_succeeded:, activated_at:, handled_at:, school:)
    attached_ids = []
    settled = false

    delivery.with_lock do
      return { settled: false, attached_submission_ids: [] } unless delivery.processing_state == "staged"

      case delivery.event
      when "check_run"
        outcome, attached_ids = replay_check_run_delivery_locked!(
          delivery: delivery,
          binding: binding,
          head_sha: head_sha,
          step2_succeeded: step2_succeeded,
          activated_at: activated_at,
          handled_at: handled_at,
          school: school
        )
        if outcome != "staged"
          delivery.update!(
            processing_state: outcome,
            attempts: delivery.attempts + 1,
            last_error: nil,
            processed_at: handled_at
          )
          settled = true
        end
      when "push"
        outcome = classify_staged_push(
          delivery: delivery,
          binding: binding,
          head_sha: head_sha,
          head_branch: head_branch,
          activated_at: activated_at,
          handled_at: handled_at,
          school: school
        )
        if outcome != "staged"
          delivery.update!(
            processing_state: outcome,
            attempts: delivery.attempts + 1,
            last_error: nil,
            processed_at: handled_at
          )
          settled = true
        end
      end
    end

    { settled: settled, attached_submission_ids: attached_ids }
  end

  def replay_check_run_delivery_locked!(delivery:, binding:, head_sha:, step2_succeeded:, activated_at:, handled_at:, school:)
    data = delivery.payload["check_run"]
    return [ "ignored", [] ] unless data.is_a?(Hash)

    external_id = GithubCheckRunMerger.positive_integer(data["external_id"])
    name = data["name"].to_s
    status = data["status"].to_s
    conclusion = data["conclusion"]
    sha = delivery.head_sha
    return [ "ignored", [] ] if external_id.nil? || name.blank? || sha.blank? || !GithubCheckRun::STATUSES.include?(status)
    return [ "ignored", [] ] if conclusion.present? && !GithubCheckRun::CONCLUSIONS.include?(conclusion)

    payload_repo_full_name = delivery.payload.dig("repository", "full_name")
    return [ "staged", [] ] if payload_repo_full_name.present? && !binding.full_name.casecmp?(payload_repo_full_name)

    enrollment = binding.enrollment
    candidates = matching_submissions_for_binding(binding: binding, head_sha: sha, payload_repo_full_name: payload_repo_full_name)
    if candidates.empty?
      return [ "staged", [] ] if other_eligible_bindings_pending_delivery?(delivery: delivery, binding: binding, school: school, now: handled_at)

      sibling_attached = GithubCheckRun
        .joins(:submission)
        .where(
          external_id: external_id,
          head_sha: sha,
          submissions: { github_repository_id: delivery.repository_id }
        )
        .exists?
      return [ "processed", [] ] if sibling_attached

      if delivery.received_at < activated_at
        return [ "ignored", [] ] unless sibling_binding_post_activation?(delivery: delivery, binding: binding, school: school, now: handled_at)

        return [ "staged", [] ]
      end

      # Settle superseded non-head check_run deliveries once Step 2 succeeded
      # and no eligible binding on (inst_id, repo_id) matches that old SHA.
      if step2_succeeded && head_sha.present? && !sha.casecmp?(head_sha)
        unless any_sibling_matches_sha?(delivery: delivery, binding: binding, head_sha: sha, payload_repo_full_name: payload_repo_full_name, school: school, now: handled_at)
          return [ "ignored", [] ]
        end
      end

      return [ "staged", [] ]
    end

    attached_ids = []
    candidates.each do |submission|
      next if delivery.received_at < activated_at && submission.created_at < activated_at

      attached = enrollment.with_lock do
        submission.with_lock do
          next false unless submission.commit_sha == sha

          current_binding = GithubRepositoryBinding
            .includes(:github_app_installation, :curriculum_module, enrollment: [ :cohort, :user ])
            .find_by(id: binding.id)
          next false unless current_binding && self.class.binding_eligible?(current_binding, school: school, now: handled_at)

          if current_binding.curriculum_module_id.nil?
            submission_module_id = submission.content_block.lesson.module_id
            if GithubRepositoryBinding.exists?(enrollment_id: enrollment.id, curriculum_module_id: submission_module_id)
              next false
            end
          end

          next false unless GithubCheckRunMerger.submission_matches_binding?(
            submission,
            binding: current_binding,
            payload_repo_full_name: payload_repo_full_name
          )

          GithubCheckRunMerger.upsert_locked!(
            submission: submission,
            attributes: {
              external_id: external_id,
              name: name,
              workflow_name: data["workflow_name"],
              workflow_path: data["workflow_path"],
              app_slug: data["app_slug"],
              check_suite_id: GithubCheckRunMerger.positive_integer(data["check_suite_id"]),
              head_sha: sha,
              status: status,
              conclusion: conclusion,
              details_url: data["details_url"],
              started_at: data["started_at"],
              completed_at: data["completed_at"]
            },
            fetched_at: handled_at,
            check_superseded_peers: true
          )
          true
        end
      end
      attached_ids << submission.id if attached
    end

    # Do not globally settle a shared delivery while another eligible binding on
    # the same repo has not yet reconciled past delivery.received_at.
    if other_eligible_bindings_pending_delivery?(delivery: delivery, binding: binding, school: school, now: handled_at)
      return [ "staged", attached_ids ]
    end

    if attached_ids.any?
      [ "processed", attached_ids ]
    elsif delivery.received_at < activated_at && !sibling_binding_post_activation?(delivery: delivery, binding: binding, school: school, now: handled_at)
      [ "ignored", [] ]
    else
      [ "staged", [] ]
    end
  end

  def classify_staged_push(delivery:, binding:, head_sha:, head_branch:, activated_at:, handled_at:, school:)
    return "staged" if other_eligible_bindings_pending_delivery?(delivery: delivery, binding: binding, school: school, now: handled_at)

    if delivery.received_at < activated_at
      return sibling_binding_post_activation?(delivery: delivery, binding: binding, school: school, now: handled_at) ? "staged" : "ignored"
    end
    return "processed" if head_sha.present? && delivery.head_sha.present? && delivery.head_sha.casecmp?(head_sha)

    push_ref = delivery.payload["ref"].to_s
    if head_branch.present? && push_ref.present?
      return push_ref == "refs/heads/#{head_branch}" ? "processed" : "ignored"
    end

    "staged"
  end

  def eligible_sibling_bindings(delivery:, binding:, school:, now:)
    GithubRepositoryBinding
      .joins(:github_app_installation)
      .includes(:github_app_installation, :curriculum_module, :github_reconciliation_state, enrollment: [ :cohort, :user ])
      .where(
        repository_id: delivery.repository_id,
        verification_state: "verified",
        github_app_installations: { installation_id: delivery.installation_id, connection_state: "connected" }
      )
      .where.not(id: binding.id)
      .select { |sibling| self.class.binding_eligible?(sibling, school: school, now: now) }
  end

  def other_eligible_bindings_pending_delivery?(delivery:, binding:, school:, now:)
    eligible_sibling_bindings(delivery: delivery, binding: binding, school: school, now: now).any? do |sibling|
      sibling_state = sibling.github_reconciliation_state
      sibling_activated_at = sibling_state&.activated_at || initial_activated_at(sibling, claim_time: now)
      sibling_activated_at <= delivery.received_at &&
        (sibling_state&.last_reconciled_at.nil? || sibling_state.last_reconciled_at < delivery.received_at)
    end
  end

  def sibling_binding_post_activation?(delivery:, binding:, school:, now:)
    eligible_sibling_bindings(delivery: delivery, binding: binding, school: school, now: now).any? do |sibling|
      sibling_state = sibling.github_reconciliation_state
      sibling_activated_at = sibling_state&.activated_at || initial_activated_at(sibling, claim_time: now)
      sibling_activated_at <= delivery.received_at
    end
  end

  def any_sibling_matches_sha?(delivery:, binding:, head_sha:, payload_repo_full_name:, school:, now:)
    eligible_sibling_bindings(delivery: delivery, binding: binding, school: school, now: now).any? do |sibling|
      matching_submissions_for_binding(
        binding: sibling,
        head_sha: head_sha,
        payload_repo_full_name: payload_repo_full_name
      ).any?
    end
  end

  # When Step 1 (`access.repository!`) just succeeded live against GitHub AFTER
  # an ambiguous staged revocation webhook was received, live provider proof
  # supersedes the ambiguous revocation once every verified binding in scope
  # has been verified after delivery.received_at.
  def replay_one_revocation_delivery!(delivery:, binding:, request_started_at:, handled_at:)
    settled = false
    verified_live_at = binding.checked_at || request_started_at
    delivery.with_lock do
      return false unless delivery.processing_state == "staged"
      return false unless verified_live_at.present? && verified_live_at >= delivery.received_at

      case delivery.event
      when "installation"
        still_unverified_others = GithubRepositoryBinding
          .joins(:github_app_installation)
          .where(
            verification_state: "verified",
            github_app_installations: { installation_id: delivery.installation_id }
          )
          .where.not(id: binding.id)
          .where("github_repository_bindings.checked_at IS NULL OR github_repository_bindings.checked_at < ?", delivery.received_at)
          .exists?

        unless still_unverified_others
          delivery.update!(
            processing_state: "ignored",
            attempts: delivery.attempts + 1,
            last_error: nil,
            processed_at: handled_at
          )
          settled = true
        end
      when "installation_repositories"
        removed_ids = Array(delivery.payload["repositories_removed_ids"]).filter_map { |id| GithubCheckRunMerger.positive_integer(id) }
        if removed_ids.include?(binding.repository_id)
          still_unverified_others = GithubRepositoryBinding
            .joins(:github_app_installation)
            .where(
              repository_id: removed_ids,
              verification_state: "verified",
              github_app_installations: { installation_id: delivery.installation_id }
            )
            .where.not(id: binding.id)
            .where("github_repository_bindings.checked_at IS NULL OR github_repository_bindings.checked_at < ?", delivery.received_at)
            .exists?

          unless still_unverified_others
            delivery.update!(
              processing_state: "ignored",
              attempts: delivery.attempts + 1,
              last_error: nil,
              processed_at: handled_at
            )
            settled = true
          end
        end
      end
    end
    settled
  end

  def settle_revoked_staged_webhooks!(binding:, now:)
    handled_at = effective_now(now)
    inst_id = binding.github_app_installation&.installation_id
    return unless inst_id

    GithubWebhookDelivery.staged
      .where(event: %w[installation installation_repositories], installation_id: inst_id)
      .where("received_at <= ?", handled_at)
      .order(:id)
      .limit(MAX_STAGED_DELIVERIES_PER_BINDING)
      .each do |delivery|
        delivery.with_lock do
          next unless delivery.processing_state == "staged"

          case delivery.event
          when "installation"
            next if GithubAppInstallation.where(installation_id: inst_id, connection_state: "connected").exists?
          when "installation_repositories"
            removed_ids = Array(delivery.payload["repositories_removed_ids"]).filter_map { |id| GithubCheckRunMerger.positive_integer(id) }
            next unless removed_ids.include?(binding.repository_id)
            next if GithubRepositoryBinding
              .joins(:github_app_installation)
              .where(
                repository_id: removed_ids,
                verification_state: "verified",
                github_app_installations: { installation_id: inst_id }
              )
              .exists?
          end

          delivery.update!(
            processing_state: "processed",
            attempts: delivery.attempts + 1,
            last_error: nil,
            processed_at: handled_at
          )
        end
      end
  end

  def matching_submissions_for_binding(binding:, head_sha:, payload_repo_full_name:)
    scope = Submission.joins(content_block: :lesson)
      .where(enrollment_id: binding.enrollment_id, commit_sha: head_sha)
    if binding.curriculum_module_id.present?
      scope = scope.where(lessons: { module_id: binding.curriculum_module_id })
    else
      excluded = GithubRepositoryBinding
        .where(enrollment_id: binding.enrollment_id)
        .where.not(curriculum_module_id: nil)
        .pluck(:curriculum_module_id)
      scope = scope.where.not(lessons: { module_id: excluded }) if excluded.present?
    end

    scope.order(:id).select do |submission|
      GithubCheckRunMerger.submission_matches_binding?(
        submission,
        binding: binding,
        payload_repo_full_name: payload_repo_full_name
      )
    end
  end

  def post_activation_latest_submissions_scope(binding:, module_ids:, head_sha:, activated_at:)
    scope = Submission.where(enrollment_id: binding.enrollment_id)
      .latest_attempts
      .joins(content_block: :lesson)
      .where(lessons: { module_id: module_ids })
      .where.not(commit_sha: [ nil, "" ])
      .where(
        "submissions.github_repository_id = :repo_id OR submissions.github_revision->>'repository_id' = :repo_id_str",
        repo_id: binding.repository_id,
        repo_id_str: binding.repository_id.to_s
      )
    if head_sha.present?
      scope.where("submissions.created_at >= ? OR LOWER(submissions.commit_sha) = ?", activated_at, head_sha.downcase)
    else
      scope.where("submissions.created_at >= ?", activated_at)
    end
  end

  def refresh_due_check_runs!(binding:, repository:, client:, covered_modules:, head_sha:, activated_at:, now:, deadline:)
    module_ids = covered_modules.map(&:id)
    return [] if module_ids.empty?

    latest_submissions = post_activation_latest_submissions_scope(
      binding: binding,
      module_ids: module_ids,
      head_sha: head_sha,
      activated_at: activated_at
    )
      .includes(:github_check_runs)
      .order(id: :asc)
      .to_a
      .select { |submission| GithubCheckRunMerger.submission_matches_binding?(submission, binding: binding) }

    return [] if latest_submissions.empty?

    policies_by_block = ExerciseCheckPolicy.active
      .where(content_block_id: latest_submissions.map(&:content_block_id).uniq)
      .index_by(&:content_block_id)

    due_submissions = latest_submissions.select do |submission|
      submission_needs_check_refresh?(submission, policy: policies_by_block[submission.content_block_id])
    end.first(MAX_CHECK_REFRESH_SUBMISSIONS_PER_BINDING)

    return [] if due_submissions.empty?

    repo_id = Integer(repository.fetch("id"))
    full_name = repository.fetch("full_name")
    installation = binding.github_app_installation
    refreshed_ids = []

    due_submissions.group_by(&:commit_sha).each do |sha, sha_submissions|
      check_budget!(deadline)
      pre_fetch_by_submission = sha_submissions.each_with_object({}) do |sub, map|
        map[sub.id] = sub.github_check_runs
          .where(head_sha: sha)
          .pluck(:id, :updated_at, :status, :conclusion, :completed_at)
          .each_with_object({}) do |(id, updated_at, status, conclusion, completed_at), versions|
            versions[id] = {
              updated_at: updated_at,
              status: status,
              conclusion: conclusion,
              completed_at: completed_at
            }
          end
      end

      runs = fetch_all_check_runs!(
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        sha: sha,
        deadline: deadline
      )
      runs = enrich_workflow_paths_for_runs(
        runs: runs,
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        sha: sha,
        deadline: deadline
      )
      fetched_at = effective_now(now)

      sha_submissions.each do |submission|
        merged = GithubCheckRunMerger.sync_snapshot!(
          submission: submission,
          runs: runs,
          fetched_at: fetched_at,
          pre_fetch_versions: pre_fetch_by_submission.fetch(submission.id),
          fetched_sha: sha
        )
        refreshed_ids << submission.id if merged[:error].nil?
      end
    end

    refreshed_ids
  end

  def submissions_needing_grade_suggestion(binding:, covered_modules:, head_sha:, activated_at:)
    module_ids = covered_modules.map(&:id)
    return [] if module_ids.empty?

    latest_submissions = post_activation_latest_submissions_scope(
      binding: binding,
      module_ids: module_ids,
      head_sha: head_sha,
      activated_at: activated_at
    )
      .includes(:submission_grade_suggestion)
      .order(:id)
      .to_a
      .select { |submission| GithubCheckRunMerger.submission_matches_binding?(submission, binding: binding) }

    return [] if latest_submissions.empty?

    policies_by_block = ExerciseCheckPolicy.active
      .where(content_block_id: latest_submissions.map(&:content_block_id).uniq)
      .index_by(&:content_block_id)

    max_run_updated_by_submission = GithubCheckRun
      .where(submission_id: latest_submissions.map(&:id))
      .group(:submission_id)
      .maximum(:updated_at)

    latest_submissions.filter_map do |submission|
      suggestion = submission.submission_grade_suggestion
      active_policy = policies_by_block[submission.content_block_id]
      latest_run_updated_at = max_run_updated_by_submission[submission.id]

      needs_eval = suggestion.nil? ||
        suggestion.commit_sha != submission.commit_sha ||
        suggestion.exercise_check_policy_id != active_policy&.id ||
        (latest_run_updated_at.present? && suggestion.evaluated_at.present? && latest_run_updated_at > suggestion.evaluated_at)

      submission.id if needs_eval
    end
  end

  def submission_needs_check_refresh?(submission, policy:)
    sha_runs = submission.github_check_runs.select { |run| run.head_sha.to_s.casecmp?(submission.commit_sha.to_s) }
    return true if sha_runs.empty?
    return true if sha_runs.any? { |run| run.status != "completed" }

    if policy&.required_checks.is_a?(Array) && policy.required_checks.any?
      seen_names = sha_runs.map(&:name).to_set
      return true if policy.required_checks.any? { |required| !seen_names.include?(required) }
    end

    false
  end

  def fetch_all_check_runs!(client:, installation:, repo_id:, full_name:, sha:, deadline:)
    runs = []
    page = 1
    loop do
      data = client.checks(
        installation: installation,
        repository_id: repo_id,
        full_name: full_name,
        sha: sha,
        page: page,
        timeout: clamped_request_timeout(deadline),
        deadline: deadline,
        monotonic: @monotonic
      )
      page_runs = Array(data["check_runs"])
      runs.concat(page_runs)
      total_count = data["total_count"]&.to_i || runs.size
      if page_runs.empty? && runs.size < total_count
        raise IncompleteCheckListError, "GitHub returned an incomplete check list"
      end
      break if runs.size >= total_count

      if page >= MAX_CHECK_RUN_PAGES
        raise IncompleteCheckListError, "GitHub returned an incomplete check list"
      end

      page += 1
    end
    runs
  end

  def enrich_workflow_paths_for_runs(runs:, client:, installation:, repo_id:, full_name:, sha:, deadline:)
    return runs unless client.respond_to?(:workflow_paths_by_check_suite)

    needs_lookup = runs.any? do |attrs|
      explicit = attrs["workflow_path"].presence || attrs.dig("check_suite", "workflow_path").presence
      explicit.nil? && GithubCheckRunMerger.positive_integer(attrs.dig("check_suite", "id")).present?
    end
    return runs unless needs_lookup

    suite_paths = client.workflow_paths_by_check_suite(
      installation: installation,
      repository_id: repo_id,
      full_name: full_name,
      head_sha: sha,
      timeout: clamped_request_timeout(deadline),
      deadline: deadline,
      monotonic: @monotonic
    )
    return runs if suite_paths.blank?

    runs.map do |attrs|
      explicit = attrs["workflow_path"].presence || attrs.dig("check_suite", "workflow_path").presence
      next attrs if explicit.present?

      suite_id = GithubCheckRunMerger.positive_integer(attrs.dig("check_suite", "id"))
      resolved = suite_id ? suite_paths[suite_id] : nil
      resolved.present? ? attrs.merge("workflow_path" => resolved) : attrs
    end
  rescue GithubAppClient::Error => error
    Rails.logger.warn("GitHub Actions workflow_path lookup failed during reconciliation for repo #{repo_id}: #{error.class.name} (status=#{error.status})")
    runs
  end

  def evaluate_grade_suggestions!(submission_ids:, now:, deadline:)
    evaluated = 0
    Submission.where(id: submission_ids).order(:id).each do |submission|
      check_budget!(deadline)
      result = GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: effective_now(now))
      evaluated += 1 if result
    rescue GithubAppClient::BudgetExceeded
      raise
    rescue StandardError => error
      Rails.logger.warn("GitHub grade suggestion evaluation failed for submission #{submission.id}: #{error.class.name}")
    end
    evaluated
  end

  def with_claimed_state(state, claim_token)
    state.with_lock do
      return :stale_claim unless state.claim_token == claim_token

      yield state
    end
  rescue ActiveRecord::RecordNotFound
    :stale_claim
  end

  def finalize_success!(state:, claim_token:, head_sha:, request_started_at:, warning_error:, now:)
    with_claimed_state(state, claim_token) do |locked|
      handled_at = effective_now(now)
      locked.update!(
        last_head_sha: head_sha || locked.last_head_sha,
        last_reconciled_at: request_started_at,
        next_reconcile_at: handled_at + RECONCILE_INTERVAL,
        consecutive_failures: 0,
        last_error: warning_error,
        last_status: "ok",
        claim_token: nil,
        claimed_until: nil
      )
      :ok
    end
  end

  def release_claim_on_budget!(state:, claim_token:)
    with_claimed_state(state, claim_token) do |locked|
      locked.update!(
        claim_token: nil,
        claimed_until: nil
      )
      :budget_exceeded
    end
  end

  def record_failure!(state:, claim_token:, error:, now:, permanent:)
    handled_at = effective_now(now)
    message = safe_error_message(error)
    status = permanent ? "failed" : "backoff"

    with_claimed_state(state, claim_token) do |locked|
      failures = locked.consecutive_failures + 1
      delay = retry_delay(failures: failures, error: error)
      locked.update!(
        consecutive_failures: failures,
        last_error: message,
        last_status: status,
        next_reconcile_at: handled_at + delay,
        claim_token: nil,
        claimed_until: nil
      )
      permanent ? :failed : :backoff
    end
  end

  def retry_delay(failures:, error:)
    if error.is_a?(GithubAppClient::Error) && error.retry_after.present? && error.retry_after.positive?
      error.retry_after.seconds.clamp(1.second, MAX_RETRY_AFTER)
    else
      BACKOFFS[[ failures - 1, BACKOFFS.length - 1 ].min]
    end
  end

  def safe_error_message(error)
    return error.message if error.is_a?(GithubAppClient::Error) || error.is_a?(Enrollment::StaleLearningWrite)

    GithubAppClient::PROVIDER_ERROR
  end
end
