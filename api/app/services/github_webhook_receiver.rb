require "openssl"

class GithubWebhookReceiver
  MAX_PAYLOAD_BYTES = 1.megabyte
  MAX_REPOSITORIES_LIST = 1000
  ZERO_SHA = ("0" * 40).freeze

  STATUS_RANK = {
    "queued" => 0,
    "requested" => 0,
    "waiting" => 0,
    "pending" => 0,
    "in_progress" => 1,
    "completed" => 2
  }.freeze

  Result = Data.define(:status, :body)

  def initialize(raw_body:, headers:, now: Time.current)
    @raw_bytes = raw_body.to_s.b
    @headers = headers
    @now = now
  end

  def call
    return Result.new(status: :content_too_large, body: { error: "Payload too large" }) if raw_bytes.bytesize > MAX_PAYLOAD_BYTES

    secret = GithubAppCredentials.webhook_secret
    return Result.new(status: :service_unavailable, body: { error: "GitHub webhooks are not configured" }) if secret.blank?

    return Result.new(status: :unauthorized, body: { error: "Invalid webhook signature" }) unless valid_signature?(secret)

    delivery_id = header_value("X-GitHub-Delivery").to_s.strip
    event = header_value("X-GitHub-Event").to_s.strip
    if delivery_id.blank? || event.blank? || delivery_id.length > 255 || event.length > 100
      return Result.new(status: :bad_request, body: { error: "Missing required GitHub webhook headers" })
    end

    parsed = parse_payload
    return Result.new(status: :bad_request, body: { error: "Invalid JSON payload" }) unless parsed.is_a?(Hash)

    unless GithubWebhookDelivery::SUPPORTED_EVENTS.include?(event)
      return Result.new(status: :ok, body: { status: "ignored", delivery_id: delivery_id, event: event, duplicate: false })
    end

    delivery, duplicate = persist_or_find_delivery(delivery_id: delivery_id, event: event, parsed: parsed)
    process_delivery(delivery, duplicate: duplicate)
  end

  private

  attr_reader :raw_bytes, :headers, :now

  def header_value(name)
    headers[name] || headers["HTTP_#{name.upcase.tr('-', '_')}"]
  end

  def valid_signature?(secret)
    provided = header_value("X-Hub-Signature-256").to_s.strip
    return false unless provided.match?(/\Asha256=[0-9a-f]{64}\z/)

    expected = "sha256=#{OpenSSL::HMAC.hexdigest('SHA256', secret.to_s.b, raw_bytes)}"
    ActiveSupport::SecurityUtils.secure_compare(expected.b, provided.b)
  end

  def parse_payload
    utf8 = raw_bytes.dup.force_encoding(Encoding::UTF_8)
    return nil unless utf8.valid_encoding?

    JSON.parse(utf8)
  rescue JSON::ParserError
    nil
  end

  def persist_or_find_delivery(delivery_id:, event:, parsed:)
    existing = GithubWebhookDelivery.find_by(delivery_id: delivery_id)
    return [ existing, true ] if existing

    attributes = normalize_attributes(delivery_id: delivery_id, event: event, parsed: parsed)
    delivery = GithubWebhookDelivery.transaction(requires_new: true) do
      GithubWebhookDelivery.create!(attributes)
    end
    [ delivery, false ]
  rescue ActiveRecord::RecordNotUnique
    [ GithubWebhookDelivery.find_by!(delivery_id: delivery_id), true ]
  rescue ActiveRecord::RecordInvalid
    existing = GithubWebhookDelivery.find_by(delivery_id: delivery_id)
    raise unless existing

    [ existing, true ]
  end

  def process_delivery(delivery, duplicate:)
    outcome = nil
    GithubWebhookDelivery.transaction(requires_new: true) do
      delivery.lock!
      if delivery.settled?
        outcome = delivery.processing_state
      else
        outcome = apply_local_event(delivery)
        delivery.update!(
          processing_state: outcome,
          attempts: delivery.attempts + 1,
          last_error: nil,
          processed_at: outcome == "staged" ? nil : now
        )
      end
    end

    Result.new(status: :ok, body: { status: outcome, delivery_id: delivery.delivery_id, event: delivery.event, duplicate: duplicate })
  rescue ActiveRecord::ActiveRecordError => error
    record_processing_failure(delivery, error)
    raise
  end

  def record_processing_failure(delivery, error)
    GithubWebhookDelivery.where(id: delivery.id, processing_state: %w[pending failed]).update_all(
      processing_state: "failed",
      attempts: delivery.attempts + 1,
      last_error: "#{error.class.name}: #{error.message.to_s.truncate(500)}",
      updated_at: now
    )
  rescue ActiveRecord::ActiveRecordError
    # Database unavailable; original error propagates so caller does not return 200.
  end

  def apply_local_event(delivery)
    school = FeatureSwitches.school(read_only: true)
    case delivery.event
    when "check_run" then process_check_run(delivery, school: school)
    when "push" then process_push(delivery, school: school)
    when "installation" then process_installation(delivery, school: school)
    when "installation_repositories" then process_installation_repositories(delivery, school: school)
    else "ignored"
    end
  end

  def process_check_run(delivery, school:)
    data = delivery.payload["check_run"]
    return "ignored" unless data.is_a?(Hash)

    external_id = positive_integer(data["external_id"])
    name = data["name"].to_s
    status = data["status"].to_s
    conclusion = data["conclusion"]
    head_sha = delivery.head_sha
    return "ignored" if external_id.nil? || name.blank? || head_sha.blank? || !GithubCheckRun::STATUSES.include?(status)
    return "ignored" if conclusion.present? && !GithubCheckRun::CONCLUSIONS.include?(conclusion)

    bindings = eligible_bindings(installation_id: delivery.installation_id, repository_id: delivery.repository_id, school: school)
    return "ignored" if bindings.empty?

    submissions = matching_submissions(bindings: bindings, head_sha: head_sha)
    return "staged" if submissions.empty?

    submissions.each do |submission|
      upsert_check_run(submission: submission, data: data, external_id: external_id, head_sha: head_sha)
    end
    "processed"
  end

  def process_push(delivery, school:)
    return "ignored" if delivery.payload["deleted"] == true || delivery.head_sha.blank?

    bindings = eligible_bindings(installation_id: delivery.installation_id, repository_id: delivery.repository_id, school: school)
    bindings.any? ? "staged" : "ignored"
  end

  def process_installation(delivery, school:)
    return "ignored" unless %w[deleted suspend].include?(delivery.action) && delivery.installation_id.present?

    installations = opted_in_installations(delivery.installation_id, school: school)
    return "ignored" if installations.empty?

    reason = if delivery.action == "deleted"
      "GitHub App installation was removed on GitHub; reconnect to restore access"
    else
      "GitHub App installation was suspended on GitHub; unsuspend or reconnect to restore access"
    end

    installations.each do |installation|
      installation.with_lock do
        installation.update!(connection_state: "failed", failure_reason: reason, checked_at: now)
        installation.github_repository_bindings.order(:id).lock.each do |binding|
          binding.update!(
            verification_state: "failed",
            failure_reason: reason,
            verified_at: nil,
            checked_at: now
          )
        end
      end
    end
    "processed"
  end

  def process_installation_repositories(delivery, school:)
    return "ignored" unless delivery.action == "removed" && delivery.installation_id.present?

    removed_ids = Array(delivery.payload["repositories_removed_ids"]).filter_map { |id| positive_integer(id) }.uniq
    return "ignored" if removed_ids.empty?

    installations = opted_in_installations(delivery.installation_id, school: school)
    return "ignored" if installations.empty?

    reason = "Repository access was removed from the GitHub App installation; re-enable access and verify again"
    updated = 0
    installations.each do |installation|
      installation.with_lock do
        installation.github_repository_bindings.where(repository_id: removed_ids).order(:id).lock.each do |binding|
          binding.update!(
            verification_state: "failed",
            failure_reason: reason,
            verified_at: nil,
            checked_at: now
          )
          updated += 1
        end
      end
    end
    updated.positive? ? "processed" : "ignored"
  end

  def opted_in_installations(external_installation_id, school:)
    GithubAppInstallation.includes(:cohort)
      .where(installation_id: external_installation_id)
      .order(:id)
      .select { |installation| webhooks_enabled_for?(installation.cohort, school: school) }
  end

  def eligible_bindings(installation_id:, repository_id:, school:)
    return [] if installation_id.nil? || repository_id.nil?

    GithubRepositoryBinding
      .joins(:github_app_installation)
      .includes(:github_app_installation, enrollment: [ :cohort, :user ])
      .where(
        repository_id: repository_id,
        verification_state: "verified",
        github_app_installations: { installation_id: installation_id, connection_state: "connected" }
      )
      .order(:id)
      .select do |binding|
        enrollment = binding.enrollment
        user = enrollment&.user
        enrollment&.active? &&
          user.present? && !user.archived? && !user.invite_pending? &&
          binding.identity_current? &&
          webhooks_enabled_for?(enrollment.cohort, school: school)
      end
  end

  def matching_submissions(bindings:, head_sha:)
    enrollment_ids = bindings.map(&:enrollment_id).uniq
    overridden_by_enrollment = GithubRepositoryBinding
      .where(enrollment_id: enrollment_ids)
      .where.not(curriculum_module_id: nil)
      .pluck(:enrollment_id, :curriculum_module_id)
      .group_by(&:first)
      .transform_values { |pairs| pairs.map(&:last) }

    found = {}
    bindings.each do |binding|
      scope = Submission.joins(content_block: :lesson)
        .where(enrollment_id: binding.enrollment_id, commit_sha: head_sha)
      if binding.curriculum_module_id.present?
        scope = scope.where(lessons: { module_id: binding.curriculum_module_id })
      else
        excluded = overridden_by_enrollment[binding.enrollment_id]
        scope = scope.where.not(lessons: { module_id: excluded }) if excluded.present?
      end
      scope.order(:id).each { |submission| found[submission.id] = submission }
    end
    found.values
  end

  def upsert_check_run(submission:, data:, external_id:, head_sha:)
    incoming_status = data["status"]
    incoming_conclusion = data["conclusion"]
    incoming_started_at = parse_time(data["started_at"])
    incoming_completed_at = parse_time(data["completed_at"])

    submission.with_lock do
      run = submission.github_check_runs.find_or_initialize_by(external_id: external_id)
      if run.persisted?
        return if regresses_existing_run?(
          run,
          status: incoming_status,
          conclusion: incoming_conclusion,
          started_at: incoming_started_at,
          completed_at: incoming_completed_at
        )
      elsif superseded_by_newer_same_name_run?(
        submission: submission,
        external_id: external_id,
        head_sha: head_sha,
        name: data["name"],
        app_slug: data["app_slug"],
        status: incoming_status,
        completed_at: incoming_completed_at
      )
        return
      end

      run.update!(
        name: data["name"],
        workflow_name: data["workflow_name"].presence || run.workflow_name,
        app_slug: data["app_slug"].presence || run.app_slug,
        head_sha: head_sha,
        status: incoming_status,
        conclusion: incoming_conclusion,
        details_url: data["details_url"].presence || run.details_url,
        started_at: incoming_started_at || run.started_at,
        completed_at: incoming_completed_at || run.completed_at,
        fetched_at: now
      )
    end
  end

  def regresses_existing_run?(run, status:, conclusion:, started_at:, completed_at:)
    existing_rank = STATUS_RANK.fetch(run.status, 0)
    incoming_rank = STATUS_RANK.fetch(status, 0)
    return true if incoming_rank < existing_rank

    if run.status == "completed" && status == "completed"
      if run.completed_at.present?
        return true if completed_at.nil? || completed_at < run.completed_at
        if completed_at == run.completed_at
          return true if run.started_at.present? && started_at.present? && started_at < run.started_at
          return true if run.conclusion.present? && conclusion.nil?
        end
      end
    elsif incoming_rank == existing_rank
      return true if run.started_at.present? && started_at.present? && started_at < run.started_at
    end

    false
  end

  def superseded_by_newer_same_name_run?(submission:, external_id:, head_sha:, name:, app_slug:, status:, completed_at:)
    peers = submission.github_check_runs
      .where(head_sha: head_sha, name: name, app_slug: app_slug)
      .where.not(external_id: external_id)
      .where(status: "completed")
      .to_a
    return false if peers.empty?

    peers.any? do |peer|
      if status == "completed"
        peer.completed_at.present? && (completed_at.nil? || completed_at < peer.completed_at)
      else
        peer.external_id > external_id
      end
    end
  end

  def webhooks_enabled_for?(cohort, school:)
    return false unless cohort

    features = FeatureSwitches.for(cohort: cohort, school: school)
    features["github_app"] == true && features["github_webhooks"] == true
  end

  def normalize_attributes(delivery_id:, event:, parsed:)
    installation_id = positive_integer(parsed.dig("installation", "id"))
    repository_id = positive_integer(parsed.dig("repository", "id"))
    action = bounded_string(parsed["action"], 100)
    head_sha = extract_head_sha(event, parsed)

    {
      delivery_id: delivery_id,
      event: event,
      action: action,
      installation_id: installation_id,
      repository_id: repository_id,
      head_sha: head_sha,
      payload: normalized_payload(event, parsed, action: action, installation_id: installation_id, repository_id: repository_id),
      processing_state: "pending",
      attempts: 0,
      received_at: now
    }
  end

  def extract_head_sha(event, parsed)
    case event
    when "check_run"
      bounded_sha(parsed.dig("check_run", "head_sha"))
    when "push"
      return nil if parsed["deleted"] == true

      sha = bounded_sha(parsed["after"])
      sha == ZERO_SHA ? nil : sha
    end
  end

  def normalized_payload(event, parsed, action:, installation_id:, repository_id:)
    case event
    when "check_run"
      cr = parsed["check_run"].is_a?(Hash) ? parsed["check_run"] : {}
      {
        "check_run" => {
          "external_id" => positive_integer(cr["id"]),
          "name" => bounded_string(cr["name"], 255),
          "status" => bounded_string(cr["status"], 50),
          "conclusion" => bounded_string(cr["conclusion"], 50),
          "head_sha" => bounded_sha(cr["head_sha"]),
          "details_url" => safe_https_url(cr["details_url"]),
          "started_at" => iso_timestamp(cr["started_at"]),
          "completed_at" => iso_timestamp(cr["completed_at"]),
          "app_slug" => bounded_string(cr.dig("app", "slug"), 100),
          "workflow_name" => bounded_string(cr.dig("check_suite", "app", "name"), 255),
          "check_suite_id" => positive_integer(cr.dig("check_suite", "id"))
        }.compact,
        "repository" => {
          "id" => repository_id,
          "full_name" => bounded_string(parsed.dig("repository", "full_name"), 255)
        }.compact,
        "installation" => { "id" => installation_id }.compact
      }
    when "push"
      {
        "ref" => bounded_string(parsed["ref"], 255),
        "before" => bounded_sha(parsed["before"]),
        "after" => bounded_sha(parsed["after"]),
        "deleted" => parsed["deleted"] == true,
        "repository" => {
          "id" => repository_id,
          "full_name" => bounded_string(parsed.dig("repository", "full_name"), 255),
          "default_branch" => bounded_string(parsed.dig("repository", "default_branch"), 255)
        }.compact,
        "installation" => { "id" => installation_id }.compact
      }
    when "installation"
      inst = parsed["installation"].is_a?(Hash) ? parsed["installation"] : {}
      {
        "action" => action,
        "installation" => {
          "id" => installation_id,
          "app_id" => positive_integer(inst["app_id"]),
          "account_id" => positive_integer(inst.dig("account", "id")),
          "account_login" => bounded_string(inst.dig("account", "login"), 100),
          "account_type" => bounded_string(inst.dig("account", "type"), 50),
          "repository_selection" => bounded_string(inst["repository_selection"], 50)
        }.compact
      }.compact
    when "installation_repositories"
      inst = parsed["installation"].is_a?(Hash) ? parsed["installation"] : {}
      removed_ids = extract_repository_ids(parsed["repositories_removed"])
      added_ids = extract_repository_ids(parsed["repositories_added"])
      {
        "action" => action,
        "installation" => {
          "id" => installation_id,
          "repository_selection" => bounded_string(inst["repository_selection"] || parsed["repository_selection"], 50)
        }.compact,
        "repositories_removed_ids" => removed_ids,
        "repositories_added_ids" => added_ids
      }.compact
    else
      {}
    end
  end

  def extract_repository_ids(entries)
    Array(entries).first(MAX_REPOSITORIES_LIST).filter_map { |entry| positive_integer(entry["id"]) if entry.is_a?(Hash) }.uniq
  end

  def positive_integer(value)
    return value if value.is_a?(Integer) && value.positive? && value <= 9_223_372_036_854_775_807
    return nil unless value.is_a?(String) && value.match?(/\A[1-9]\d{0,18}\z/)

    int = value.to_i
    int <= 9_223_372_036_854_775_807 ? int : nil
  end

  def bounded_string(value, max_length)
    return nil unless value.is_a?(String)

    trimmed = value.strip
    trimmed.present? ? trimmed[0, max_length] : nil
  end

  def bounded_sha(value)
    return nil unless value.is_a?(String)

    sha = value.strip.downcase
    sha.match?(/\A[0-9a-f]{7,64}\z/) ? sha : nil
  end

  def safe_https_url(value)
    str = bounded_string(value, 1024)
    return nil if str.blank?

    uri = URI.parse(str)
    uri.is_a?(URI::HTTPS) && uri.host.present? ? str : nil
  rescue URI::InvalidURIError
    nil
  end

  def iso_timestamp(value)
    time = parse_time(value)
    time&.utc&.iso8601
  end

  def parse_time(value)
    return value if value.is_a?(Time) || value.is_a?(ActiveSupport::TimeWithZone)
    return nil unless value.is_a?(String) && value.present?

    Time.iso8601(value)
  rescue ArgumentError
    nil
  end
end
