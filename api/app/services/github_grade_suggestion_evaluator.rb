# Pure grade-suggestion evaluator for X-6.4 / AS-11.
#
# ABSOLUTE INVARIANT: This service NEVER writes Submission.grade,
# Submission#graded_at, Submission#graded_by_id, SubmissionCriterionResult,
# Progress/LearnerProgress, GithubIssueDelivery, or any student notification.
# The instructor's explicit grade save remains authoritative.
class GithubGradeSuggestionEvaluator
  SHA_PATTERN = /\A[0-9a-f]{40,64}\z/i
  PENDING_STATUSES = %w[queued in_progress pending requested waiting].freeze
  INCONCLUSIVE_CONCLUSIONS = %w[skipped neutral cancelled timed_out action_required stale startup_failure].freeze

  Result = Data.define(
    :outcome,
    :suggested_grade,
    :reason_code,
    :reason_summary,
    :evidence,
    :exercise_check_policy_id,
    :policy_version,
    :commit_sha,
    :evaluated_at
  )

  def self.enabled_for?(cohort, school: nil)
    return false unless cohort.present?

    FeatureSwitches.enabled?(:github_app, cohort: cohort, school: school) &&
      FeatureSwitches.enabled?(:github_grade_suggestions, cohort: cohort, school: school)
  end

  # Pure evaluation: performs zero DB writes and zero HTTP calls.
  def self.evaluate(submission:, policy:, check_runs:, latest_submission_id: nil, active_policy: :same_as_policy, now: Time.current)
    resolved_active = active_policy == :same_as_policy ? policy : active_policy
    new(
      submission: submission,
      policy: policy,
      active_policy: resolved_active,
      check_runs: Array(check_runs),
      latest_submission_id: latest_submission_id,
      now: now
    ).evaluate
  end

  # Persists the evaluation to submission_grade_suggestions only when the
  # submission's cohort has opted into both github_app and github_grade_suggestions.
  # Makes zero writes and returns nil when disabled.
  def self.evaluate_submission!(submission, now: Time.current, policy: :active)
    enrollment = submission.enrollment
    cohort = enrollment&.cohort
    return nil unless enrollment && enabled_for?(cohort)

    active_policy = ExerciseCheckPolicy.active.find_by(content_block_id: submission.content_block_id)
    selected_policy = policy == :active ? active_policy : policy
    latest_id = submission.latest_attempt&.id
    runs = GithubCheckRun.where(submission_id: submission.id).to_a

    result = evaluate(
      submission: submission,
      policy: selected_policy,
      active_policy: active_policy,
      check_runs: runs,
      latest_submission_id: latest_id,
      now: now
    )

    persist_result!(submission: submission, enrollment: enrollment, result: result)
  end

  def self.persist_result!(submission:, enrollment:, result:)
    attributes = {
      enrollment_id: enrollment.id,
      content_block_id: submission.content_block_id,
      exercise_check_policy_id: result.exercise_check_policy_id,
      policy_version: result.policy_version,
      commit_sha: result.commit_sha,
      outcome: result.outcome,
      suggested_grade: result.suggested_grade,
      reason_code: result.reason_code,
      reason_summary: result.reason_summary,
      evidence: result.evidence,
      evaluated_at: result.evaluated_at
    }

    attempts = 0
    begin
      attempts += 1
      SubmissionGradeSuggestion.transaction do
        record = SubmissionGradeSuggestion.lock.find_or_initialize_by(submission_id: submission.id)
        record.assign_attributes(attributes)
        record.save!
        record
      end
    rescue ActiveRecord::RecordNotUnique
      raise if attempts >= 2

      retry
    end
  end
  private_class_method :persist_result!

  def initialize(submission:, policy:, active_policy:, check_runs:, latest_submission_id:, now:)
    @submission = submission
    @policy = policy
    @active_policy = active_policy
    @check_runs = check_runs
    @latest_submission_id = latest_submission_id
    @now = now
  end

  def evaluate
    unless verified_revision?
      return build_result(
        outcome: "no_suggestion",
        reason_code: "unverified_revision",
        reason_summary: "Submission lacks verified immutable GitHub revision provenance.",
        policy_for_record: nil,
        evidence: base_evidence(policy_ref: nil)
      )
    end

    if @latest_submission_id.present? && @latest_submission_id != @submission.id
      return build_result(
        outcome: "stale_evidence",
        reason_code: "superseded_submission",
        reason_summary: "A newer submission attempt exists for this exercise; this attempt's checks are stale.",
        policy_for_record: @policy,
        evidence: base_evidence(policy_ref: @policy).merge("latest_submission_id" => @latest_submission_id)
      )
    end

    if @policy.present? && policy_archived_or_superseded?
      return build_result(
        outcome: "stale_evidence",
        reason_code: "stale_policy",
        reason_summary: "Exercise check policy v#{@policy.version} is no longer active; re-evaluate against the current policy.",
        policy_for_record: @policy,
        evidence: base_evidence(policy_ref: @policy).merge(
          "active_policy_id" => @active_policy&.id,
          "active_policy_version" => @active_policy&.version
        )
      )
    end

    required_checks = normalized_required_checks
    if @policy.nil? || required_checks.empty?
      return build_result(
        outcome: "no_suggestion",
        reason_code: "missing_policy",
        reason_summary: "No active exercise check policy with required checks is configured for this exercise.",
        policy_for_record: nil,
        evidence: base_evidence(policy_ref: nil)
      )
    end

    if branch_mismatch?
      return build_result(
        outcome: "no_suggestion",
        reason_code: "branch_mismatch",
        reason_summary: "Submitted branch #{submitted_branch.inspect} does not match required branch #{@policy.allowed_branch.inspect}.",
        policy_for_record: @policy,
        evidence: base_evidence(policy_ref: @policy)
      )
    end

    if workflow_tampered?
      return build_result(
        outcome: "no_suggestion",
        reason_code: "workflow_tampered",
        reason_summary: "Submitted workflow does not match the approved workflow revision for this exercise.",
        policy_for_record: @policy,
        evidence: base_evidence(policy_ref: @policy)
      )
    end

    evaluate_check_runs(required_checks)
  end

  private

  def revision
    @submission.github_revision
  end

  def verified_revision?
    return false unless revision.is_a?(Hash) && revision.present?
    return false unless revision["repository_id"].to_i.positive?

    sha = @submission.commit_sha.to_s
    return false unless SHA_PATTERN.match?(sha)

    revision_sha = revision["commit_sha"].presence
    return false if revision_sha && !revision_sha.to_s.casecmp?(sha)

    true
  end

  def policy_archived_or_superseded?
    return true unless @policy.active?
    return false if @active_policy.nil?

    @active_policy.id != @policy.id
  end

  def normalized_required_checks
    return [] unless @policy&.required_checks.is_a?(Array)

    @policy.required_checks.filter_map { |name| name.to_s.strip.presence }.uniq
  end

  def trusted_app_slugs
    return Set.new unless @policy&.allowed_app_slugs.is_a?(Array)

    @policy.allowed_app_slugs.filter_map { |slug| slug.to_s.strip.downcase.presence }.to_set
  end

  def submitted_branch
    return @submission.branch.presence unless revision.is_a?(Hash)

    raw = revision["branch"].presence || revision["ref"].presence || @submission.branch.presence
    raw&.to_s&.sub(%r{\Arefs/heads/}, "")&.presence
  end

  def branch_mismatch?
    return false if @policy.allowed_branch.blank?

    submitted_branch != @policy.allowed_branch
  end

  def workflow_tampered?
    return true if revision.is_a?(Hash) && revision["workflow_tampered"] == true

    if @policy.expected_workflow_path.present? && revision.is_a?(Hash) && revision["workflow_path"].present?
      return true if revision["workflow_path"].to_s != @policy.expected_workflow_path
    end

    return false if @policy.expected_workflow_sha.blank?

    observed_sha = revision.is_a?(Hash) ? revision["workflow_sha"].presence : nil
    observed_sha.nil? || !observed_sha.to_s.casecmp?(@policy.expected_workflow_sha)
  end

  def evaluate_check_runs(required_checks)
    target_sha = @submission.commit_sha.to_s
    matching_sha_runs, other_sha_runs = @check_runs.partition { |run| run.head_sha.to_s.casecmp?(target_sha) }

    if matching_sha_runs.empty? && other_sha_runs.any?
      return build_result(
        outcome: "stale_evidence",
        reason_code: "stale_sha",
        reason_summary: "Recorded check runs belong to an older or different commit SHA than the submitted revision.",
        policy_for_record: @policy,
        evidence: base_evidence(policy_ref: @policy).merge(
          "observed_head_shas" => other_sha_runs.map(&:head_sha).compact.uniq
        )
      )
    end

    trusted_slugs = trusted_app_slugs
    authoritative_runs = []
    missing_checks = []
    untrusted_checks = []

    required_checks.each do |check_name|
      candidates = matching_sha_runs.select { |run| run.name == check_name }
      trusted = candidates.select { |run| trusted_producer?(run, trusted_slugs) }

      if trusted.any?
        authoritative_runs << select_authoritative_run(trusted)
      elsif candidates.any?
        latest_untrusted = select_authoritative_run(candidates)
        untrusted_checks << {
          "name" => check_name,
          "app_slug" => latest_untrusted.app_slug,
          "workflow_name" => latest_untrusted.workflow_name,
          "external_id" => latest_untrusted.external_id
        }
      else
        missing_checks << check_name
      end
    end

    evidence = base_evidence(policy_ref: @policy).merge(
      "missing_checks" => missing_checks,
      "untrusted_checks" => untrusted_checks,
      "runs" => authoritative_runs.map { |run| serialize_run(run) }
    )

    if untrusted_checks.any?
      names = untrusted_checks.map { |entry| entry["name"] }.join(", ")
      return build_result(
        outcome: "no_suggestion",
        reason_code: "untrusted_producer",
        reason_summary: "Required check(s) came from an untrusted GitHub App producer: #{names}.",
        policy_for_record: @policy,
        evidence: evidence
      )
    end

    if missing_checks.any?
      return build_result(
        outcome: "no_suggestion",
        reason_code: "missing_required_check",
        reason_summary: "Missing required exercise check(s) for this commit: #{missing_checks.join(', ')}.",
        policy_for_record: @policy,
        evidence: evidence
      )
    end

    pending_runs = authoritative_runs.select { |run| run.status != "completed" || PENDING_STATUSES.include?(run.status) }
    if pending_runs.any?
      names = pending_runs.map(&:name).join(", ")
      return build_result(
        outcome: "no_suggestion",
        reason_code: "check_pending",
        reason_summary: "Required exercise check(s) are still pending: #{names}.",
        policy_for_record: @policy,
        evidence: evidence
      )
    end

    inconclusive_runs = authoritative_runs.select do |run|
      run.conclusion.nil? || INCONCLUSIVE_CONCLUSIONS.include?(run.conclusion) || !%w[success failure].include?(run.conclusion)
    end
    if inconclusive_runs.any?
      details = inconclusive_runs.map { |run| "#{run.name} (#{run.conclusion || 'unknown'})" }.join(", ")
      return build_result(
        outcome: "no_suggestion",
        reason_code: "check_inconclusive",
        reason_summary: "Required exercise check(s) ended without a pass/fail test outcome: #{details}.",
        policy_for_record: @policy,
        evidence: evidence
      )
    end

    failed_runs = authoritative_runs.select { |run| run.conclusion == "failure" }
    if failed_runs.any?
      names = failed_runs.map(&:name).join(", ")
      return build_result(
        outcome: "review_for_redo",
        reason_code: "required_check_failed",
        reason_summary: "Required exercise check(s) failed: #{names}. Review and write Redo feedback before saving a grade.",
        policy_for_record: @policy,
        evidence: evidence
      )
    end

    build_result(
      outcome: "suggest_b",
      suggested_grade: "B",
      reason_code: "all_required_checks_passed",
      reason_summary: "All #{authoritative_runs.size} required exercise check(s) passed for commit #{target_sha[0, 12]}; B suggested for instructor review.",
      policy_for_record: @policy,
      evidence: evidence
    )
  end

  # Producer identity strictly checks app_slug against policy.allowed_app_slugs.
  # Never trusts mutable workflow_name alone.
  def trusted_producer?(run, trusted_slugs)
    run.app_slug.present? && trusted_slugs.include?(run.app_slug.to_s.strip.downcase)
  end

  def select_authoritative_run(runs)
    runs.max_by do |run|
      primary_time = run.completed_at || run.started_at || run.fetched_at || Time.at(0)
      started_time = run.started_at || Time.at(0)
      [ primary_time.to_f, started_time.to_f, run.external_id.to_i, run.id.to_i ]
    end
  end

  def serialize_run(run)
    {
      "id" => run.id,
      "external_id" => run.external_id,
      "check_suite_id" => run.respond_to?(:check_suite_id) ? run.check_suite_id : nil,
      "name" => run.name,
      "app_slug" => run.app_slug,
      "head_sha" => run.head_sha,
      "status" => run.status,
      "conclusion" => run.conclusion,
      "details_url" => run.details_url,
      "started_at" => run.started_at&.iso8601(6),
      "completed_at" => run.completed_at&.iso8601(6),
      "fetched_at" => run.fetched_at&.iso8601(6)
    }
  end

  def base_evidence(policy_ref:)
    {
      "commit_sha" => @submission.commit_sha,
      "branch" => submitted_branch,
      "repository_id" => revision.is_a?(Hash) ? revision["repository_id"] : nil,
      "repository_full_name" => revision.is_a?(Hash) ? revision["repository_full_name"] : nil,
      "allowed_branch" => policy_ref&.allowed_branch,
      "allowed_app_slugs" => policy_ref&.allowed_app_slugs || [],
      "expected_workflow_path" => policy_ref&.expected_workflow_path,
      "expected_workflow_sha" => policy_ref&.expected_workflow_sha,
      "observed_workflow_sha" => revision.is_a?(Hash) ? revision["workflow_sha"] : nil,
      "required_checks" => policy_ref&.required_checks || [],
      "missing_checks" => [],
      "untrusted_checks" => [],
      "runs" => []
    }
  end

  def build_result(outcome:, reason_code:, reason_summary:, policy_for_record:, evidence:, suggested_grade: nil)
    Result.new(
      outcome: outcome,
      suggested_grade: suggested_grade,
      reason_code: reason_code,
      reason_summary: reason_summary,
      evidence: evidence,
      exercise_check_policy_id: policy_for_record&.id,
      policy_version: policy_for_record&.version,
      commit_sha: @submission.commit_sha,
      evaluated_at: @now
    )
  end
end
