# Records durable GitHub issue delivery intents inside the grading transaction
# without performing any provider HTTP. Strictly scoped by submission enrollment,
# exercise content block, and verified GitHub App repository binding.
class GithubIssueDeliveryPlanner
  def self.enabled_for?(cohort, school: nil)
    return false unless cohort.present?

    features = FeatureSwitches.for(cohort: cohort, school: school)
    features["github_sync"] == true &&
      features["github_app"] == true &&
      features["github_issue_delivery_v2"] == true
  end

  # Marks prior pending/failed intents in this (enrollment, content_block) scope
  # obsolete while preserving any active claim_token / claimed_until lease so an
  # in-flight worker keeps serializing GitHub mutations until it finishes.
  def self.obsolete_pending!(enrollment_id:, content_block_id:, now: Time.current)
    return 0 unless enrollment_id && content_block_id

    ids = GithubIssueDelivery
      .where(enrollment_id: enrollment_id, content_block_id: content_block_id, status: %w[pending failed])
      .order(:id)
      .lock
      .pluck(:id)
    return 0 if ids.empty?

    GithubIssueDelivery
      .where(id: ids)
      .update_all(status: "obsolete", next_retry_at: nil, updated_at: now)
  end

  # Never trusts learner-supplied submission.github_issue_url. Only prior
  # delivered or reconciled GithubIssueDelivery rows scoped by
  # (enrollment_id, content_block_id, repository_id) are authoritative.
  def self.prior_tracked_issue(enrollment_id:, content_block_id:, repository_id:)
    return nil unless enrollment_id && content_block_id && repository_id.present?

    prior = GithubIssueDelivery
      .where(
        enrollment_id: enrollment_id,
        content_block_id: content_block_id,
        repository_id: repository_id,
        status: %w[delivered obsolete]
      )
      .where.not(issue_number: nil)
      .order(id: :desc)
      .first
    return nil unless prior

    {
      issue_number: prior.issue_number,
      issue_url: prior.issue_url,
      last_action: prior.status == "delivered" ? prior.action : "open_or_comment"
    }
  end

  def self.record!(submission:, grade:, feedback:, now: Time.current)
    enrollment = submission.enrollment
    return nil unless enrollment && enabled_for?(enrollment.cohort)

    curriculum_module_id = submission.content_block.lesson.module_id
    binding = GithubRepositoryAccess.binding_for(enrollment: enrollment, curriculum_module_id: curriculum_module_id)
    repository_id = binding&.repository_id
    repository_full_name = binding&.full_name

    # Lock scope rows in deterministic id order (enrollment & submission are already locked).
    scope_rows = GithubIssueDelivery
      .where(enrollment_id: enrollment.id, content_block_id: submission.content_block_id)
      .order(:id)
      .lock
      .to_a

    has_uncertain_open = scope_rows.any? do |row|
      row.action == "open_or_comment" &&
        row.issue_number.nil? &&
        (repository_id.nil? || row.repository_id.nil? || row.repository_id == repository_id) &&
        (row.claimed?(now) || (row.attempts.positive? && %w[pending failed obsolete].include?(row.status)))
    end

    obsolete_pending!(enrollment_id: enrollment.id, content_block_id: submission.content_block_id, now: now)

    prior = prior_tracked_issue(
      enrollment_id: enrollment.id,
      content_block_id: submission.content_block_id,
      repository_id: repository_id
    )

    if grade == "R"
      GithubIssueDelivery.create!(
        submission: submission,
        enrollment: enrollment,
        content_block: submission.content_block,
        github_repository_binding: binding,
        repository_id: repository_id,
        repository_full_name: repository_full_name,
        action: "open_or_comment",
        grade: "R",
        # Snapshot strictly student-facing feedback; never private staff notes.
        feedback_body: feedback.to_s,
        dedupe_token: SecureRandom.hex(16),
        status: "pending",
        issue_number: prior&.dig(:issue_number),
        issue_url: prior&.dig(:issue_url),
        attempts: 0
      )
    elsif %w[A B C].include?(grade)
      needs_close = (prior && prior[:issue_number].present? && prior[:last_action] != "close") || has_uncertain_open
      return nil unless needs_close

      GithubIssueDelivery.create!(
        submission: submission,
        enrollment: enrollment,
        content_block: submission.content_block,
        github_repository_binding: binding,
        repository_id: repository_id,
        repository_full_name: repository_full_name,
        action: "close",
        grade: grade,
        feedback_body: feedback.presence,
        dedupe_token: SecureRandom.hex(16),
        status: "pending",
        issue_number: prior&.dig(:issue_number),
        issue_url: prior&.dig(:issue_url),
        attempts: 0
      )
    end
  end
end
