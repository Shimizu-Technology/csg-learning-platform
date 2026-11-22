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

  def self.obsolete_pending!(enrollment_id:, content_block_id:)
    return 0 unless enrollment_id && content_block_id

    GithubIssueDelivery
      .where(enrollment_id: enrollment_id, content_block_id: content_block_id, status: %w[pending failed])
      .update_all(status: "obsolete", next_retry_at: nil, updated_at: Time.current)
  end

  def self.prior_tracked_issue(enrollment_id:, content_block_id:, repository_id:, repository_full_name: nil)
    return nil unless enrollment_id && content_block_id && repository_id.present?

    prior = GithubIssueDelivery
      .where(enrollment_id: enrollment_id, content_block_id: content_block_id, repository_id: repository_id, status: "delivered")
      .where.not(issue_number: nil)
      .order(delivered_at: :desc, id: :desc)
      .first

    if prior
      return {
        issue_number: prior.issue_number,
        issue_url: prior.issue_url,
        last_action: prior.action
      }
    end

    return nil if repository_full_name.blank?

    pattern = %r{\Ahttps://github\.com/#{Regexp.escape(repository_full_name)}/issues/(\d+)\z}i
    urls = Submission
      .where(enrollment_id: enrollment_id, content_block_id: content_block_id)
      .where.not(github_issue_url: [ nil, "" ])
      .order(created_at: :desc, id: :desc)
      .pluck(:github_issue_url)

    urls.each do |url|
      match = pattern.match(url.to_s.strip)
      next unless match

      return {
        issue_number: match[1].to_i,
        issue_url: url,
        last_action: "open_or_comment"
      }
    end

    nil
  end

  def self.record!(submission:, grade:, feedback:)
    enrollment = submission.enrollment
    return nil unless enrollment && enabled_for?(enrollment.cohort)

    obsolete_pending!(enrollment_id: enrollment.id, content_block_id: submission.content_block_id)

    curriculum_module_id = submission.content_block.lesson.module_id
    binding = GithubRepositoryAccess.binding_for(enrollment: enrollment, curriculum_module_id: curriculum_module_id)
    repository_id = binding&.repository_id
    repository_full_name = binding&.full_name
    prior = prior_tracked_issue(
      enrollment_id: enrollment.id,
      content_block_id: submission.content_block_id,
      repository_id: repository_id,
      repository_full_name: repository_full_name
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
      return nil unless prior && prior[:issue_number].present? && prior[:last_action] != "close"

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
        issue_number: prior[:issue_number],
        issue_url: prior[:issue_url],
        attempts: 0
      )
    end
  end
end
