# Drains pending GithubIssueDelivery outbox rows through the GitHub App
# without holding DB locks across provider HTTP. Serializes active mutations
# per (enrollment, content_block) scope using durable claim leases, persists
# verified repository identity before the first write, rechecks active claim
# leases immediately before every GitHub mutation, and reconciles ambiguous
# timeouts via a single bounded paginated marker scan across uncertain predecessors.
class GithubIssueDeliveryDrain
  BATCH_SIZE = 25
  MAX_ATTEMPTS = GithubIssueDelivery::MAX_ATTEMPTS
  CLAIM_LEASE = 5.minutes
  DEFAULT_MAX_DURATION = 20.seconds
  MAX_UNCERTAIN_PREDECESSORS = 10
  MAX_RETRY_AFTER = 24.hours
  BACKOFFS = [ 5.minutes, 15.minutes, 1.hour, 4.hours ].freeze
  PERMANENT_STATUSES = [ 401, 403, 404, 422 ].freeze

  class NonRetryableError < StandardError; end

  class ClaimAborted < StandardError
    attr_reader :outcome

    def initialize(outcome)
      @outcome = outcome
      super("Delivery claim aborted: #{outcome}")
    end
  end

  def self.preview(now = Time.current)
    school = FeatureSwitches.school(read_only: true)
    return { would_claim: 0, enabled: false } unless school["github_app"] == true && school["github_issue_delivery_v2"] == true

    { would_claim: GithubIssueDelivery.due(now).limit(BATCH_SIZE).count }
  end

  def initialize(client: nil, batch_size: BATCH_SIZE, max_duration: DEFAULT_MAX_DURATION,
    monotonic: -> { Process.clock_gettime(Process::CLOCK_MONOTONIC) }, clock: -> { Time.current })
    @client = client
    @batch_size = batch_size
    @max_duration = max_duration
    @monotonic = monotonic
    @clock = clock
  end

  def call(now: Time.current, metrics: {})
    metrics[:claimed] ||= 0
    metrics[:sent] ||= 0
    metrics[:failed] ||= 0

    school = FeatureSwitches.school(read_only: true)
    return metrics unless school["github_app"] == true && school["github_issue_delivery_v2"] == true

    deadline = @max_duration ? @monotonic.call + @max_duration : nil
    ids = GithubIssueDelivery.due(now).order(:id).limit(@batch_size).pluck(:id)
    ids.each do |id|
      break if deadline && @monotonic.call >= deadline

      outcome = deliver_one!(id, now: now, school: school, force: false, deadline: deadline)
      break if outcome == :budget_exceeded
      next if %i[skipped in_flight scope_busy stale_claim].include?(outcome)

      metrics[:claimed] += 1
      case outcome
      when :delivered then metrics[:sent] += 1
      when :failed, :retry_scheduled then metrics[:failed] += 1
      end
    end
    metrics
  end

  def deliver_one!(delivery_or_id, now: Time.current, school: nil, force: false, deadline: nil)
    delivery = delivery_or_id.is_a?(GithubIssueDelivery) ? delivery_or_id : GithubIssueDelivery.find_by(id: delivery_or_id)
    return :skipped unless delivery
    return :budget_exceeded if deadline && @monotonic.call >= deadline

    claim = claim_delivery!(delivery, now: now, school: school, force: force)
    return claim unless claim.is_a?(Hash)

    execute_delivery!(
      delivery,
      prior_attempts: claim.fetch(:prior_attempts),
      claim_token: claim.fetch(:claim_token),
      now: now,
      deadline: deadline
    )
  end

  private

  # Acquires locks in the same strict order as SubmissionsController#grade:
  # enrollment -> submission -> scope github_issue_deliveries (ordered by id).
  def claim_delivery!(delivery, now:, school:, force:)
    enrollment = delivery.enrollment
    submission = delivery.submission
    return :skipped unless enrollment && submission

    enrollment.with_lock do
      submission.lock!
      scope_rows = GithubIssueDelivery
        .where(enrollment_id: delivery.enrollment_id, content_block_id: delivery.content_block_id)
        .order(:id)
        .lock
        .to_a

      locked = scope_rows.find { |row| row.id == delivery.id }
      return :skipped unless locked

      claim_time = effective_now(now)
      # Active claim lease is NEVER bypassed, even with force: true.
      return :in_flight if locked.claimed?(claim_time)

      eligible_status = force ? %w[pending failed].include?(locked.status) : locked.status == "pending"
      return :skipped unless eligible_status
      return :skipped if !force && locked.next_retry_at.present? && locked.next_retry_at > claim_time

      cohort = enrollment.cohort
      unless GithubIssueDeliveryPlanner.enabled_for?(cohort, school: school)
        locked.update!(status: "obsolete", next_retry_at: nil, claim_token: nil, claimed_until: nil,
          last_error: "GitHub issue delivery is disabled for this cohort")
        delivery.reload
        return :obsolete
      end

      if stale_delivery?(locked, submission)
        locked.update!(status: "obsolete", next_retry_at: nil, claim_token: nil, claimed_until: nil)
        delivery.reload
        return :obsolete
      end

      # Serialize active GitHub mutations per (enrollment, content_block) scope.
      if scope_rows.any? { |row| row.id != locked.id && row.claimed?(claim_time) }
        return :scope_busy
      end

      prior_attempts = locked.attempts
      claim_token = SecureRandom.hex(16)
      locked.update!(
        status: "pending",
        attempts: prior_attempts + 1,
        claim_token: claim_token,
        claimed_until: claim_time + CLAIM_LEASE,
        next_retry_at: nil
      )
      delivery.reload
      { prior_attempts: prior_attempts, claim_token: claim_token }
    end
  end

  def stale_delivery?(delivery, submission)
    return true unless submission.grade == delivery.grade
    return true if delivery.action == "open_or_comment" && submission.latest_attempt&.id != submission.id

    false
  end

  def effective_now(reference_now)
    current = @clock.call
    reference_now && reference_now > current ? reference_now : current
  end

  def clamped_request_timeout(deadline)
    return nil unless deadline

    remaining = deadline - @monotonic.call
    raise GithubAppClient::BudgetExceeded, "GitHub drain budget exhausted" if remaining <= 0

    [ remaining, GithubAppClient::DEFAULT_TIMEOUT.to_f ].min
  end

  def execute_delivery!(delivery, prior_attempts:, claim_token:, now:, deadline:)
    state = { mutated: false }
    client = @client || GithubAppClient.new
    binding = resolve_binding(delivery)
    raise NonRetryableError, "Verify a repository binding before delivering GitHub feedback" unless binding

    repo_timeout = clamped_request_timeout(deadline)
    access = GithubRepositoryAccess.new(binding, client: client)
    repo = access.repository!(timeout: repo_timeout)
    repo_id = Integer(repo.fetch("id"))
    full_name = repo.fetch("full_name")

    if delivery.repository_id.present? && delivery.repository_id != repo_id
      raise NonRetryableError, "Repository binding changed since this grade was saved; verify the repository and grade again"
    end

    checkpoint = persist_verified_repository_and_check_active!(
      delivery,
      claim_token: claim_token,
      binding: binding,
      repo_id: repo_id,
      full_name: full_name,
      now: now,
      deadline: deadline
    )
    return checkpoint unless checkpoint == :active

    installation = binding.github_app_installation
    existing_issue_number = resolve_existing_issue_number(delivery, repo_id: repo_id)

    result = if delivery.action == "open_or_comment"
      deliver_redo!(
        delivery: delivery,
        claim_token: claim_token,
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        existing_issue_number: existing_issue_number,
        reconcile: prior_attempts.positive?,
        now: now,
        deadline: deadline,
        state: state
      )
    else
      deliver_close!(
        delivery: delivery,
        claim_token: claim_token,
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        existing_issue_number: existing_issue_number,
        reconcile: prior_attempts.positive?,
        now: now,
        deadline: deadline,
        state: state
      )
    end

    if result == :obsolete
      return finalize_obsolete!(delivery, claim_token: claim_token)
    end

    finalize_success!(
      delivery,
      claim_token: claim_token,
      binding: binding,
      repo_id: repo_id,
      full_name: full_name,
      result: result,
      now: now
    )
  rescue GithubAppClient::BudgetExceeded
    release_claim_on_budget!(delivery, claim_token: claim_token, prior_attempts: prior_attempts, mutated: state[:mutated])
  rescue ClaimAborted => aborted
    aborted.outcome
  rescue NonRetryableError, GithubRepositoryAccess::BindingChanged, GithubAppClient::Error, StandardError => error
    record_failure!(delivery, error, claim_token: claim_token, now: now)
  end

  # Persists verified repository identity BEFORE any GitHub write and aborts if
  # the claim expired, was lost, or was superseded while repository verification ran.
  def persist_verified_repository_and_check_active!(delivery, claim_token:, binding:, repo_id:, full_name:, now:, deadline:)
    submission = delivery.submission
    submission.with_lock do
      delivery.lock!
      return :stale_claim unless delivery.claim_token == claim_token

      if delivery.status != "pending" || stale_delivery?(delivery, submission) || superseded_in_scope?(delivery)
        delivery.update!(status: "obsolete", next_retry_at: nil, claim_token: nil, claimed_until: nil)
        return :obsolete
      end

      return :stale_claim unless delivery.claimed?(effective_now(now))

      if deadline && @monotonic.call >= deadline
        raise GithubAppClient::BudgetExceeded, "GitHub drain budget exhausted"
      end

      delivery.update!(
        github_repository_binding_id: binding.id,
        repository_id: repo_id,
        repository_full_name: full_name
      )
      :active
    end
  end

  # Rechecks active claim token, unexpired lease, non-superseded status, and
  # remaining wall-clock budget immediately BEFORE every mutating GitHub API call.
  # Raises outside submission.with_lock so obsolete/claim-release writes commit.
  def verify_claim_active!(delivery, claim_token:, now:, deadline:)
    outcome = nil
    submission = delivery.submission
    submission.with_lock do
      delivery.lock!
      if delivery.claim_token != claim_token
        outcome = :stale_claim
      elsif delivery.status != "pending" || stale_delivery?(delivery, submission) || superseded_in_scope?(delivery)
        delivery.update!(status: "obsolete", next_retry_at: nil, claim_token: nil, claimed_until: nil)
        outcome = :obsolete
      elsif !delivery.claimed?(effective_now(now))
        outcome = :stale_claim
      elsif deadline && @monotonic.call >= deadline
        outcome = :budget_exceeded
      else
        outcome = :active
      end
    end

    raise GithubAppClient::BudgetExceeded, "GitHub drain budget exhausted" if outcome == :budget_exceeded
    raise ClaimAborted, outcome unless outcome == :active

    clamped_request_timeout(deadline)
  end

  def superseded_in_scope?(delivery)
    GithubIssueDelivery
      .where(enrollment_id: delivery.enrollment_id, content_block_id: delivery.content_block_id)
      .where("id > ?", delivery.id)
      .where.not(status: "obsolete")
      .exists?
  end

  def release_claim_on_budget!(delivery, claim_token:, prior_attempts:, mutated:)
    delivery.submission.with_lock do
      delivery.lock!
      return :stale_claim unless delivery.claim_token == claim_token

      if delivery.status == "obsolete"
        delivery.update!(next_retry_at: nil, claim_token: nil, claimed_until: nil)
        return :obsolete
      end

      attrs = { claim_token: nil, claimed_until: nil, next_retry_at: nil }
      attrs[:attempts] = prior_attempts unless mutated
      delivery.update!(attrs)
      :budget_exceeded
    end
  end

  def finalize_obsolete!(delivery, claim_token:)
    delivery.submission.with_lock do
      delivery.lock!
      return :stale_claim unless delivery.claim_token == claim_token

      delivery.update!(status: "obsolete", next_retry_at: nil, claim_token: nil, claimed_until: nil)
      :obsolete
    end
  end

  def finalize_success!(delivery, claim_token:, binding:, repo_id:, full_name:, result:, now:)
    submission = delivery.submission
    submission.with_lock do
      delivery.lock!
      return :stale_claim unless delivery.claim_token == claim_token

      # Never revert an obsolete row back to delivered; record discovered issue
      # identity so superseding intents can immediately target the created issue.
      if delivery.status == "obsolete"
        delivery.update!(
          github_repository_binding_id: binding.id,
          repository_id: repo_id,
          repository_full_name: full_name,
          issue_number: result.fetch(:issue_number),
          issue_url: result.fetch(:issue_url),
          next_retry_at: nil,
          claim_token: nil,
          claimed_until: nil
        )
        return :obsolete
      end

      delivery.update!(
        status: "delivered",
        github_repository_binding_id: binding.id,
        repository_id: repo_id,
        repository_full_name: full_name,
        issue_number: result.fetch(:issue_number),
        issue_url: result.fetch(:issue_url),
        delivered_at: effective_now(now),
        next_retry_at: nil,
        claim_token: nil,
        claimed_until: nil,
        last_error: nil
      )
      if result[:issue_url].present?
        submission.update_column(:github_issue_url, result[:issue_url])
      end
      :delivered
    end
  end

  def resolve_binding(delivery)
    candidate = delivery.github_repository_binding
    return candidate if candidate && candidate.enrollment_id == delivery.enrollment_id

    GithubRepositoryAccess.binding_for(
      enrollment: delivery.enrollment,
      curriculum_module_id: delivery.content_block.lesson.module_id
    )
  end

  def resolve_existing_issue_number(delivery, repo_id:)
    if delivery.issue_number.present? && (delivery.repository_id.nil? || delivery.repository_id == repo_id)
      return delivery.issue_number
    end

    GithubIssueDeliveryPlanner.prior_tracked_issue(
      enrollment_id: delivery.enrollment_id,
      content_block_id: delivery.content_block_id,
      repository_id: repo_id
    )&.dig(:issue_number)
  end

  def uncertain_predecessors(delivery, repo_id:)
    rows = GithubIssueDelivery
      .where(
        enrollment_id: delivery.enrollment_id,
        content_block_id: delivery.content_block_id,
        action: "open_or_comment",
        issue_number: nil,
        status: %w[obsolete failed]
      )
      .where("id < ?", delivery.id)
      .where("attempts > 0")
      .where("repository_id IS NULL OR repository_id = ?", repo_id)
      .order(id: :desc)
      .limit(MAX_UNCERTAIN_PREDECESSORS + 1)
      .to_a

    if rows.size > MAX_UNCERTAIN_PREDECESSORS
      raise GithubAppClient::InconclusiveSearchError,
        "Too many prior uncertain GitHub deliveries to reconcile safely; inspect the repository before retrying"
    end

    rows
  end

  def record_discovered_predecessor_issue!(predecessor, repo_id:, full_name:, found:)
    return unless predecessor

    predecessor.with_lock do
      if predecessor.issue_number.nil?
        predecessor.update!(
          repository_id: predecessor.repository_id || repo_id,
          repository_full_name: predecessor.repository_full_name.presence || full_name,
          issue_number: found.fetch("number"),
          issue_url: found.fetch("html_url")
        )
      end
    end
  end

  def find_by_markers(client:, installation:, repo_id:, full_name:, markers:, issue_number: nil, deadline: nil)
    timeout = clamped_request_timeout(deadline)
    client.find_issue_by_markers(
      installation: installation,
      repository_id: repo_id,
      full_name: full_name,
      markers: markers,
      issue_number: issue_number,
      timeout: timeout,
      deadline: deadline,
      monotonic: @monotonic
    )
  end

  def deliver_redo!(delivery:, claim_token:, client:, installation:, repo_id:, full_name:, existing_issue_number:, reconcile:, now:, deadline:, state:)
    if existing_issue_number.nil?
      own_marker = reconcile ? delivery.marker : nil
      predecessors = uncertain_predecessors(delivery, repo_id: repo_id)
      candidate_markers = ([ own_marker ] + predecessors.map(&:marker)).compact.uniq

      if candidate_markers.any?
        found = find_by_markers(
          client: client,
          installation: installation,
          repo_id: repo_id,
          full_name: full_name,
          markers: candidate_markers,
          deadline: deadline
        )
        if found
          if own_marker && found["matched_marker"] == own_marker
            return { issue_number: found.fetch("number"), issue_url: found.fetch("html_url") }
          end

          matched_predecessor = predecessors.find { |p| p.marker == found["matched_marker"] }
          record_discovered_predecessor_issue!(matched_predecessor, repo_id: repo_id, full_name: full_name, found: found)
          existing_issue_number = found.fetch("number")
        end
      end
    end

    if existing_issue_number.present?
      read_timeout = clamped_request_timeout(deadline)
      issue = client.get_issue(installation: installation, repository_id: repo_id, full_name: full_name, issue_number: existing_issue_number, timeout: read_timeout)
      if issue["state"] == "closed"
        write_timeout = verify_claim_active!(delivery, claim_token: claim_token, now: now, deadline: deadline)
        state[:mutated] = true
        issue = client.reopen_issue(installation: installation, repository_id: repo_id, full_name: full_name, issue_number: existing_issue_number, timeout: write_timeout)
      end

      already_posted = reconcile && find_by_markers(
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        markers: [ delivery.marker ],
        issue_number: existing_issue_number,
        deadline: deadline
      ).present?

      unless already_posted
        write_timeout = verify_claim_active!(delivery, claim_token: claim_token, now: now, deadline: deadline)
        state[:mutated] = true
        client.add_issue_comment(
          installation: installation,
          repository_id: repo_id,
          full_name: full_name,
          issue_number: existing_issue_number,
          body: build_redo_comment(delivery),
          timeout: write_timeout
        )
      end

      return { issue_number: issue.fetch("number"), issue_url: issue.fetch("html_url") }
    end

    write_timeout = verify_claim_active!(delivery, claim_token: claim_token, now: now, deadline: deadline)
    state[:mutated] = true
    created = client.create_issue(
      installation: installation,
      repository_id: repo_id,
      full_name: full_name,
      title: build_issue_title(delivery),
      body: build_issue_body(delivery),
      timeout: write_timeout
    )
    { issue_number: created.fetch("number"), issue_url: created.fetch("html_url") }
  end

  def deliver_close!(delivery:, claim_token:, client:, installation:, repo_id:, full_name:, existing_issue_number:, reconcile:, now:, deadline:, state:)
    if existing_issue_number.nil?
      predecessors = uncertain_predecessors(delivery, repo_id: repo_id)
      if predecessors.any?
        found = find_by_markers(
          client: client,
          installation: installation,
          repo_id: repo_id,
          full_name: full_name,
          markers: predecessors.map(&:marker),
          deadline: deadline
        )
        if found
          matched_predecessor = predecessors.find { |p| p.marker == found["matched_marker"] }
          record_discovered_predecessor_issue!(matched_predecessor, repo_id: repo_id, full_name: full_name, found: found)
          existing_issue_number = found.fetch("number")
        end
      end
    end

    return :obsolete unless existing_issue_number.present?

    read_timeout = clamped_request_timeout(deadline)
    issue = client.get_issue(installation: installation, repository_id: repo_id, full_name: full_name, issue_number: existing_issue_number, timeout: read_timeout)
    if issue["state"] != "closed"
      already_commented = reconcile && find_by_markers(
        client: client,
        installation: installation,
        repo_id: repo_id,
        full_name: full_name,
        markers: [ delivery.marker ],
        issue_number: existing_issue_number,
        deadline: deadline
      ).present?

      write_timeout = verify_claim_active!(delivery, claim_token: claim_token, now: now, deadline: deadline)
      state[:mutated] = true
      issue = client.close_issue(
        installation: installation,
        repository_id: repo_id,
        full_name: full_name,
        issue_number: existing_issue_number,
        comment: already_commented ? nil : build_close_comment(delivery),
        timeout: write_timeout
      )
    end

    { issue_number: issue.fetch("number"), issue_url: issue.fetch("html_url") }
  end

  def record_failure!(delivery, error, claim_token:, now:)
    retryable = retryable_error?(error)
    message = safe_error_message(error)
    handled_at = effective_now(now)
    outcome = nil

    delivery.submission.with_lock do
      delivery.lock!
      return :stale_claim unless delivery.claim_token == claim_token

      if delivery.status == "obsolete"
        delivery.update!(next_retry_at: nil, claim_token: nil, claimed_until: nil)
        return :obsolete
      end

      if !retryable || delivery.attempts >= MAX_ATTEMPTS
        delivery.update!(status: "failed", next_retry_at: nil, claim_token: nil, claimed_until: nil, last_error: message)
        outcome = :failed
      else
        delay = retry_delay(delivery, error)
        delivery.update!(status: "pending", next_retry_at: handled_at + delay, claim_token: nil, claimed_until: nil, last_error: message)
        outcome = :retry_scheduled
      end
    end

    outcome
  end

  def retry_delay(delivery, error)
    if error.is_a?(GithubAppClient::Error) && error.retry_after.present? && error.retry_after.positive?
      error.retry_after.seconds.clamp(1.second, MAX_RETRY_AFTER)
    else
      BACKOFFS[[ delivery.attempts - 1, BACKOFFS.length - 1 ].min]
    end
  end

  def retryable_error?(error)
    return false if error.is_a?(NonRetryableError) ||
      error.is_a?(GithubRepositoryAccess::BindingChanged) ||
      error.is_a?(GithubAppClient::InconclusiveSearchError)

    if error.is_a?(GithubAppClient::Error)
      return true if error.rate_limited?
      return false if PERMANENT_STATUSES.include?(error.status)

      return error.transient?
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
