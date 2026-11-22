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
  MATERIAL_DECISION_FIELDS = %i[
    exercise_check_policy_id
    policy_version
    commit_sha
    outcome
    suggested_grade
    reason_code
  ].freeze

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

    features = FeatureSwitches.for(cohort: cohort, school: school)
    features["github_app"] == true && features["github_grade_suggestions"] == true
  end

  # Pure evaluation: performs zero DB writes and zero HTTP calls.
  def self.evaluate(submission:, policy:, check_runs:, binding: nil, latest_submission_id: nil, active_policy: :same_as_policy, now: Time.current)
    resolved_active = active_policy == :same_as_policy ? policy : active_policy
    new(
      submission: submission,
      policy: policy,
      active_policy: resolved_active,
      binding: binding,
      check_runs: Array(check_runs),
      latest_submission_id: latest_submission_id,
      now: now
    ).evaluate
  end

  # Persists the evaluation to submission_grade_suggestions only when the
  # submission's cohort has opted into both github_app and github_grade_suggestions.
  # Serializes in canonical lock order (Enrollment -> Submission) so curriculum
  # copy and concurrent check refreshes cannot race or persist stale block IDs.
  # Makes zero policy/suggestion writes and returns nil when disabled.
  def self.evaluate_submission!(submission, now: Time.current, policy: :active)
    return nil unless submission.enrollment_id

    ApplicationRecord.transaction do
      enrollment = Enrollment.includes(:cohort).lock("FOR NO KEY UPDATE").find(submission.enrollment_id)
      cohort = enrollment.cohort
      return nil unless enabled_for?(cohort)

      locked_submission = Submission.includes(content_block: :lesson).lock("FOR NO KEY UPDATE").find(submission.id)
      active_policy = ExerciseCheckPolicy.active.find_by(content_block_id: locked_submission.content_block_id)
      selected_policy = policy == :active ? active_policy : policy
      binding = GithubRepositoryAccess.binding_for(
        enrollment: enrollment,
        curriculum_module_id: locked_submission.content_block.lesson.module_id
      )
      latest_id = locked_submission.latest_attempt&.id
      runs = GithubCheckRun.where(submission_id: locked_submission.id).to_a

      result = evaluate(
        submission: locked_submission,
        policy: selected_policy,
        active_policy: active_policy,
        binding: binding,
        check_runs: runs,
        latest_submission_id: latest_id,
        now: now
      )

      persist_result!(submission: locked_submission, enrollment: enrollment, result: result)
    end
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
      # Savepoint (requires_new: true) prevents RecordNotUnique from poisoning an outer transaction.
      SubmissionGradeSuggestion.transaction(requires_new: true) do
        record = SubmissionGradeSuggestion.lock.find_or_initialize_by(submission_id: submission.id)
        if record.persisted? && record.decision.present? && material_change?(record, attributes)
          merged_evidence = result.evidence.deep_dup
          merged_evidence["prior_decision"] = {
            "decision" => record.decision,
            "override_reason" => record.override_reason,
            "decided_by_id" => record.decided_by_id,
            "decided_at" => record.decided_at&.iso8601(6),
            "prior_outcome" => record.outcome,
            "prior_suggested_grade" => record.suggested_grade,
            "prior_reason_code" => record.reason_code,
            "prior_policy_version" => record.policy_version,
            "prior_commit_sha" => record.commit_sha,
            "superseded_at" => result.evaluated_at.iso8601(6)
          }
          attributes = attributes.merge(
            evidence: merged_evidence,
            decision: nil,
            override_reason: nil,
            decided_by_id: nil,
            decided_at: nil
          )
        elsif record.persisted? && record.evidence.is_a?(Hash) && record.evidence["prior_decision"].present?
          merged_evidence = result.evidence.deep_dup
          merged_evidence["prior_decision"] = record.evidence["prior_decision"]
          attributes = attributes.merge(evidence: merged_evidence)
        end
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

  def self.material_change?(record, attributes)
    MATERIAL_DECISION_FIELDS.any? { |field| record.public_send(field) != attributes[field] }
  end
  private_class_method :material_change?

  def initialize(submission:, policy:, active_policy:, binding:, check_runs:, latest_submission_id:, now:)
    @submission = submission
    @policy = policy
    @active_policy = active_policy
    @binding = binding
    @check_runs = check_runs
    @latest_submission_id = latest_submission_id
    @now = now
  end

  def evaluate
    unless verified_revision?
      return build_result(
        outcome: "no_suggestion",
        reason_code: "unverified_revision",
        reason_summary: "Submission lacks verified immutable GitHub revision provenance or an active verified repository binding.",
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

  def strict_positive_integer(value)
    value.is_a?(Integer) && value.positive? ? value : nil
  end

  def verified_revision?
    return false unless revision.is_a?(Hash) && revision.present?

    repo_id = strict_positive_integer(revision["repository_id"])
    binding_id = strict_positive_integer(revision["binding_id"])
    return false unless repo_id && binding_id
    return false unless revision["content_digest"].is_a?(String) && revision["content_digest"].strip.present?

    sha = @submission.commit_sha.to_s
    return false unless SHA_PATTERN.match?(sha)

    revision_sha = revision["commit_sha"].presence
    return false if revision_sha && !revision_sha.to_s.casecmp?(sha)

    verified_binding?(binding_id: binding_id, repository_id: repo_id)
  end

  def verified_binding?(binding_id:, repository_id:)
    return false unless @binding.present?

    @binding.id == binding_id &&
      @binding.repository_id == repository_id &&
      @binding.verification_state == "verified" &&
      @binding.identity_current? &&
      @binding.github_app_installation&.connection_state == "connected"
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

  def captured_workflow_entry(policy_ref)
    return nil unless policy_ref&.expected_workflow_path.present? && revision.is_a?(Hash)

    workflow_files = revision["workflow_files"]
    return nil unless workflow_files.is_a?(Hash)

    entry = workflow_files[policy_ref.expected_workflow_path]
    entry.is_a?(Hash) ? entry : nil
  end

  def workflow_tampered?
    return true if revision.is_a?(Hash) && revision["workflow_tampered"] == true
    return false if @policy.expected_workflow_path.blank? && @policy.expected_workflow_sha.blank?

    # Fail closed whenever expected_workflow_path (or expected_workflow_sha) is configured:
    # the captured revision must prove the workflow file existed at commit_sha.
    return true if @policy.expected_workflow_path.blank?

    entry = captured_workflow_entry(@policy)
    return true unless entry && entry["present"] == true
    return false if @policy.expected_workflow_sha.blank?

    expected = @policy.expected_workflow_sha.to_s.downcase
    oid = entry["oid"].to_s.downcase.presence
    sha256 = entry["sha256"].to_s.downcase.presence
    !(oid == expected || sha256 == expected)
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

    pending_runs = authoritative_runs.select { |run| pending_run?(run) }
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

  def pending_run?(run)
    run.status != "completed" || PENDING_STATUSES.include?(run.status)
  end

  # Selects the authoritative run for one required check name on target_sha:
  # 1. If ANY trusted pending run exists on target_sha, fail closed as pending
  #    so a faster parallel job never bypasses a still-running job.
  # 2. A completed run supersedes an earlier completed run only when it is a
  #    sequential rerun (started_at >= earlier.completed_at, or higher external_id
  #    when neither has timestamps). Overlapping conflicting same-named jobs fail
  #    closed (failure beats inconclusive beats success).
  def select_authoritative_run(runs)
    pending_runs, completed_runs = runs.partition { |run| pending_run?(run) }
    return newest_pending(pending_runs) if pending_runs.any?

    active_completed = completed_runs.reject do |earlier|
      completed_runs.any? { |later| sequential_rerun_supersedes?(later: later, earlier: earlier) }
    end

    failed = active_completed.select { |run| run.conclusion == "failure" }
    return newest_by_recency(failed) if failed.any?

    inconclusive = active_completed.select { |run| run.conclusion != "success" }
    return newest_by_recency(inconclusive) if inconclusive.any?

    newest_by_recency(active_completed)
  end

  def sequential_rerun_supersedes?(later:, earlier:)
    return false if later.equal?(earlier)

    if later.started_at.present? && earlier.completed_at.present?
      later.started_at >= earlier.completed_at &&
        (later.started_at > earlier.completed_at || later.external_id.to_i > earlier.external_id.to_i)
    elsif later.started_at.nil? && earlier.completed_at.nil?
      later.external_id.to_i > earlier.external_id.to_i
    else
      false
    end
  end

  def newest_pending(runs)
    runs.max_by do |run|
      [ run.external_id.to_i, (run.started_at || run.fetched_at || Time.at(0)).to_f, run.id.to_i ]
    end
  end

  def newest_by_recency(runs)
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
    wf_entry = captured_workflow_entry(policy_ref)
    {
      "commit_sha" => @submission.commit_sha,
      "branch" => submitted_branch,
      "binding_id" => revision.is_a?(Hash) ? revision["binding_id"] : nil,
      "repository_id" => revision.is_a?(Hash) ? revision["repository_id"] : nil,
      "repository_full_name" => revision.is_a?(Hash) ? revision["repository_full_name"] : nil,
      "allowed_branch" => policy_ref&.allowed_branch,
      "allowed_app_slugs" => policy_ref&.allowed_app_slugs || [],
      "expected_workflow_path" => policy_ref&.expected_workflow_path,
      "expected_workflow_sha" => policy_ref&.expected_workflow_sha,
      "workflow_file_present" => wf_entry ? wf_entry["present"] == true : nil,
      "observed_workflow_oid" => wf_entry ? wf_entry["oid"] : nil,
      "observed_workflow_sha256" => wf_entry ? wf_entry["sha256"] : nil,
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
