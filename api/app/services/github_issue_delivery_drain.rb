# Drains pending GithubIssueDelivery outbox rows through the GitHub App
# without holding DB locks across provider HTTP. Reconciles ambiguous timeouts
# via an embedded HTML comment marker before creating duplicate issues/comments.
class GithubIssueDeliveryDrain
  BATCH_SIZE = 25
  MAX_ATTEMPTS = GithubIssueDelivery::MAX_ATTEMPTS
  CLAIM_LEASE = 5.minutes
  BACKOFFS = [ 5.minutes, 15.minutes, 1.hour, 4.hours ].freeze
  PERMANENT_STATUSES = [ 401, 403, 404, 422 ].freeze

  class NonRetryableError < StandardError; end

  def self.preview(now = Time.current)
    school = FeatureSwitches.school(read_only: true)
    return { would_claim: 0, enabled: false } unless school["github_app"] == true && school["github_issue_delivery_v2"] == true

    { would_claim: GithubIssueDelivery.due(now).limit(BATCH_SIZE).count }
  end

  def initialize(client: nil, batch_size: BATCH_SIZE)
    @client = client
    @batch_size = batch_size
  end

  def call(now: Time.current, metrics: {})
    metrics[:claimed] ||= 0
    metrics[:sent] ||= 0
    metrics[:failed] ||= 0

    school = FeatureSwitches.school(read_only: true)
    return metrics unless school["github_app"] == true && school["github_issue_delivery_v2"] == true

    ids = GithubIssueDelivery.due(now).order(:id).limit(@batch_size).pluck(:id)
    ids.each do |id|
      outcome = deliver_one!(id, now: now, school: school, force: false)
      next if outcome == :skipped

      metrics[:claimed] += 1
      case outcome
      when :delivered then metrics[:sent] += 1
      when :failed, :retry_scheduled then metrics[:failed] += 1
      end
    end
    metrics
  end

  def deliver_one!(delivery_or_id, now: Time.current, school: nil, force: false)
    delivery = delivery_or_id.is_a?(GithubIssueDelivery) ? delivery_or_id : GithubIssueDelivery.find_by(id: delivery_or_id)
    return :skipped unless delivery

    prior_attempts = nil
    delivery.with_lock do
      eligible_status = force ? %w[pending failed].include?(delivery.status) : delivery.status == "pending"
      return :skipped unless eligible_status
      return :skipped if !force && delivery.next_retry_at.present? && delivery.next_retry_at > now

      cohort = delivery.enrollment.cohort
      unless GithubIssueDeliveryPlanner.enabled_for?(cohort, school: school)
        delivery.update!(status: "obsolete", next_retry_at: nil, last_error: "GitHub issue delivery is disabled for this cohort")
        return :obsolete
      end

      if stale_delivery?(delivery, delivery.submission)
        delivery.update!(status: "obsolete", next_retry_at: nil)
        return :obsolete
      end

      prior_attempts = delivery.attempts
      delivery.update!(
        status: "pending",
        attempts: prior_attempts + 1,
        next_retry_at: now + CLAIM_LEASE
      )
    end

    execute_delivery!(delivery, prior_attempts: prior_attempts, now: now)
  end

  private

  def stale_delivery?(delivery, submission)
    return true unless submission.grade == delivery.grade
    return true if delivery.action == "open_or_comment" && submission.latest_attempt&.id != submission.id

    false
  end

  def execute_delivery!(delivery, prior_attempts:, now:)
    client = @client || GithubAppClient.new
    binding = resolve_binding(delivery)
    raise NonRetryableError, "Verify a repository binding before delivering GitHub feedback" unless binding

    access = GithubRepositoryAccess.new(binding, client: client)
    repo = access.repository!
    repo_id = Integer(repo.fetch("id"))
    full_name = repo.fetch("full_name")

    if delivery.repository_id.present? && delivery.repository_id != repo_id
      raise NonRetryableError, "Repository binding changed since this grade was saved; verify the repository and grade again"
    end

    installation = binding.github_app_installation
    existing_issue_number = resolve_existing_issue_number(delivery, repo_id: repo_id, full_name: full_name)

    result = if delivery.action == "open_or_comment"
      deliver_redo!(
        delivery: delivery,
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        existing_issue_number: existing_issue_number,
        reconcile: prior_attempts.positive?
      )
    else
      deliver_close!(
        delivery: delivery,
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        existing_issue_number: existing_issue_number,
        reconcile: prior_attempts.positive?
      )
    end

    if result == :obsolete
      delivery.with_lock { delivery.update!(status: "obsolete", next_retry_at: nil) }
      return :obsolete
    end

    delivery.with_lock do
      delivery.update!(
        status: "delivered",
        github_repository_binding_id: binding.id,
        repository_id: repo_id,
        repository_full_name: full_name,
        issue_number: result.fetch(:issue_number),
        issue_url: result.fetch(:issue_url),
        delivered_at: now,
        next_retry_at: nil,
        last_error: nil
      )
      if result[:issue_url].present?
        delivery.submission.update_column(:github_issue_url, result[:issue_url])
      end
    end
    :delivered
  rescue NonRetryableError, GithubRepositoryAccess::BindingChanged, GithubAppClient::Error, StandardError => error
    record_failure!(delivery, error, now: now)
  end

  def resolve_binding(delivery)
    candidate = delivery.github_repository_binding
    return candidate if candidate && candidate.enrollment_id == delivery.enrollment_id

    GithubRepositoryAccess.binding_for(
      enrollment: delivery.enrollment,
      curriculum_module_id: delivery.content_block.lesson.module_id
    )
  end

  def resolve_existing_issue_number(delivery, repo_id:, full_name:)
    if delivery.issue_number.present? && (delivery.repository_id.nil? || delivery.repository_id == repo_id)
      return delivery.issue_number
    end

    GithubIssueDeliveryPlanner.prior_tracked_issue(
      enrollment_id: delivery.enrollment_id,
      content_block_id: delivery.content_block_id,
      repository_id: repo_id,
      repository_full_name: full_name
    )&.dig(:issue_number)
  end

  def deliver_redo!(delivery:, client:, installation:, repo_id:, full_name:, existing_issue_number:, reconcile:)
    if existing_issue_number.present?
      issue = client.get_issue(installation: installation, repository_id: repo_id, full_name: full_name, issue_number: existing_issue_number)
      if issue["state"] == "closed"
        issue = client.reopen_issue(installation: installation, repository_id: repo_id, full_name: full_name, issue_number: existing_issue_number)
      end

      already_posted = reconcile && client.find_issue_by_marker(
        installation: installation,
        repository_id: repo_id,
        full_name: full_name,
        marker: delivery.marker,
        issue_number: existing_issue_number
      ).present?

      unless already_posted
        client.add_issue_comment(
          installation: installation,
          repository_id: repo_id,
          full_name: full_name,
          issue_number: existing_issue_number,
          body: build_redo_comment(delivery)
        )
      end

      return { issue_number: issue.fetch("number"), issue_url: issue.fetch("html_url") }
    end

    if reconcile
      found = client.find_issue_by_marker(
        installation: installation,
        repository_id: repo_id,
        full_name: full_name,
        marker: delivery.marker
      )
      return { issue_number: found.fetch("number"), issue_url: found.fetch("html_url") } if found
    end

    created = client.create_issue(
      installation: installation,
      repository_id: repo_id,
      full_name: full_name,
      title: build_issue_title(delivery),
      body: build_issue_body(delivery)
    )
    { issue_number: created.fetch("number"), issue_url: created.fetch("html_url") }
  end

  def deliver_close!(delivery:, client:, installation:, repo_id:, full_name:, existing_issue_number:, reconcile:)
    return :obsolete unless existing_issue_number.present?

    issue = client.get_issue(installation: installation, repository_id: repo_id, full_name: full_name, issue_number: existing_issue_number)
    if issue["state"] != "closed"
      already_commented = reconcile && client.find_issue_by_marker(
        installation: installation,
        repository_id: repo_id,
        full_name: full_name,
        marker: delivery.marker,
        issue_number: existing_issue_number
      ).present?

      issue = client.close_issue(
        installation: installation,
        repository_id: repo_id,
        full_name: full_name,
        issue_number: existing_issue_number,
        comment: already_commented ? nil : build_close_comment(delivery)
      )
    end

    { issue_number: issue.fetch("number"), issue_url: issue.fetch("html_url") }
  end

  def record_failure!(delivery, error, now:)
    retryable = retryable_error?(error)
    message = safe_error_message(error)
    outcome = nil

    delivery.with_lock do
      return :obsolete if delivery.status == "obsolete"

      if !retryable || delivery.attempts >= MAX_ATTEMPTS
        delivery.update!(status: "failed", next_retry_at: nil, last_error: message)
        outcome = :failed
      else
        backoff = BACKOFFS[[ delivery.attempts - 1, BACKOFFS.length - 1 ].min]
        delivery.update!(status: "pending", next_retry_at: now + backoff, last_error: message)
        outcome = :retry_scheduled
      end
    end

    outcome
  end

  def retryable_error?(error)
    return false if error.is_a?(NonRetryableError) || error.is_a?(GithubRepositoryAccess::BindingChanged)

    if error.is_a?(GithubAppClient::Error)
      return false if PERMANENT_STATUSES.include?(error.status)
      return true if error.status == 429 || (error.status && error.status >= 500)

      return error.status.nil? && error.message == GithubAppClient::PROVIDER_ERROR
    end

    true
  end

  def safe_error_message(error)
    return error.message if error.is_a?(NonRetryableError) || error.is_a?(GithubAppClient::Error)

    GithubAppClient::PROVIDER_ERROR
  end

  def build_issue_title(delivery)
    "Redo: #{delivery.content_block.display_title}"
  end

  def build_issue_body(delivery)
    block = delivery.content_block
    lesson = block.lesson
    parts = []
    parts << "**Exercise:** #{block.title}" if block.title.present?
    parts << "**Lesson:** #{lesson.title}"
    parts << ""
    parts << "### Feedback"
    parts << delivery.feedback_body.to_s
    parts << ""
    parts << delivery.marker
    parts.join("\n")
  end

  def build_redo_comment(delivery)
    header = delivery.feedback_body.present? ? "**Redo requested again**\n\n#{delivery.feedback_body}" : "**Redo requested again** — please review and resubmit."
    "#{header}\n\n#{delivery.marker}"
  end

  def build_close_comment(delivery)
    header = if delivery.feedback_body.present?
      "Graded **#{delivery.grade}** - #{delivery.feedback_body}"
    else
      "Graded **#{delivery.grade}** - Passing!"
    end
    "#{header}\n\n#{delivery.marker}"
  end
end
