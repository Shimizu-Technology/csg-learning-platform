class GithubCheckRunSyncService
  GITHUB_API_BASE = "https://api.github.com".freeze
  STATUS_RANK = {
    "queued" => 1,
    "requested" => 1,
    "waiting" => 1,
    "pending" => 1,
    "in_progress" => 2,
    "completed" => 3
  }.freeze

  def initialize(submission:, token:, now: Time.current, app_client: nil)
    @submission = submission
    @token = token
    @now = now
    @app_client = app_client
  end

  def call
    @repository_access = nil
    cohort = submission.enrollment&.cohort
    features = FeatureSwitches.for(cohort: cohort)
    return failure("GitHub checks are disabled for this course") unless features["github_sync"]

    owner, repository = repository_coordinates
    return failure("A GitHub repository URL is required before checks can be refreshed") unless owner && repository
    target_sha = submission.commit_sha
    return failure("A commit SHA is required before checks can be refreshed") if target_sha.blank?

    if cohort && features["github_app"] == true
      @app_binding = GithubRepositoryAccess.binding_for(enrollment: submission.enrollment, curriculum_module_id: submission.content_block.lesson.module_id)
      return failure("Verify a repository binding before refreshing checks") unless @app_binding
      return failure("Submission repository does not match the verified binding") unless @app_binding.full_name.casecmp?("#{owner}/#{repository}")
      if submission.github_revision && (submission.github_revision.fetch("repository_id") != @app_binding.repository_id || submission.github_revision.fetch("binding_id") != @app_binding.id)
        return failure("Submitted revision belongs to a different repository binding; its evidence is preserved")
      end

      @app_client ||= GithubAppClient.new
      @repository_access = GithubRepositoryAccess.new(@app_binding, client: @app_client)
      @repository_access.repository!
    end

    pre_fetch_versions = snapshot_existing_runs(target_sha)
    result = fetch_runs("#{GITHUB_API_BASE}/repos/#{owner}/#{repository}/commits/#{target_sha}/check-runs", sha: target_sha)
    return failure(result[:error]) if result[:error]

    runs = result[:runs]
    sha_changed = false
    imported = submission.with_lock do
      if submission.commit_sha != target_sha
        sha_changed = true
        next []
      end

      locked_existing = submission.github_check_runs.where(head_sha: target_sha).order(:id).lock.index_by(&:external_id)
      current = runs.map do |attributes|
        upsert_run(attributes, locked_existing: locked_existing, pre_fetch_versions: pre_fetch_versions)
      end
      prune_obsolete_current_commit_runs(
        runs,
        target_sha: target_sha,
        locked_existing: locked_existing,
        pre_fetch_versions: pre_fetch_versions
      )
      current
    end
    return failure("Submission commit changed while refreshing checks; refresh again") if sha_changed

    suggestion = if cohort && features["github_app"] == true && features["github_grade_suggestions"] == true
      begin
        GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: Time.current)
      rescue StandardError => error
        Rails.logger.warn("GitHub grade suggestion evaluation failed for submission #{submission.id}: #{error.class.name}")
        nil
      end
    end
    {
      check_runs: imported.sort_by { |run| [ run.completed_at || Time.zone.at(0), run.id ] }.reverse,
      grade_suggestion: suggestion,
      error: nil
    }
  rescue GithubRepositoryAccess::BindingChanged => error
    failure(error.message)
  rescue GithubAppClient::Error => error
    @repository_access&.fail_current_verification!(error)
    failure(error.message)
  rescue URI::InvalidURIError
    failure("The submission repository URL is invalid")
  rescue StandardError => error
    Rails.logger.warn("GitHub check import failed for submission #{submission.id}: #{error.class.name}")
    failure("GitHub checks are temporarily unavailable")
  end

  private

  attr_reader :submission, :token, :now

  def snapshot_existing_runs(target_sha)
    submission.github_check_runs.where(head_sha: target_sha).each_with_object({}) do |run, map|
      map[run.external_id] = {
        updated_at: run.updated_at,
        status: run.status,
        conclusion: run.conclusion,
        completed_at: run.completed_at
      }
    end
  end

  def repository_coordinates
    [ submission.repo_url, submission.pr_url, submission.github_code_url ].compact_blank.each do |value|
      uri = URI.parse(value)
      next unless uri.scheme == "https" && uri.host == "github.com"

      owner, repository = uri.path.split("/").reject(&:blank?).first(2)
      return [ owner, repository&.delete_suffix(".git") ] if owner.present? && repository.present?
    end
    nil
  end

  def upsert_run(attributes, locked_existing:, pre_fetch_versions:)
    external_id = attributes.fetch("id")
    run = locked_existing[external_id] || submission.github_check_runs.find_or_initialize_by(external_id: external_id)

    if run.persisted? && concurrently_modified?(run, pre_fetch_versions[external_id]) && stale_incoming_update?(run, attributes)
      return run
    end

    update_attrs = {
      name: attributes.fetch("name"),
      workflow_name: attributes.dig("check_suite", "app", "name"),
      app_slug: attributes.dig("app", "slug"),
      check_suite_id: attributes.dig("check_suite", "id"),
      head_sha: attributes.fetch("head_sha"),
      status: attributes.fetch("status"),
      conclusion: attributes["conclusion"],
      details_url: attributes["details_url"],
      started_at: attributes["started_at"],
      completed_at: attributes["completed_at"],
      fetched_at: now
    }
    incoming_workflow_path = attributes["workflow_path"].presence || attributes.dig("check_suite", "workflow_path").presence
    update_attrs[:workflow_path] = incoming_workflow_path if incoming_workflow_path.present?

    run.update!(update_attrs)
    run
  end

  def concurrently_modified?(run, pre_fetch)
    return true if pre_fetch.nil?

    run.updated_at != pre_fetch[:updated_at] ||
      run.status != pre_fetch[:status] ||
      run.conclusion != pre_fetch[:conclusion] ||
      run.completed_at != pre_fetch[:completed_at]
  end

  def stale_incoming_update?(existing, attributes)
    incoming_rank = STATUS_RANK.fetch(attributes.fetch("status").to_s, 0)
    current_rank = STATUS_RANK.fetch(existing.status.to_s, 0)
    return true if incoming_rank < current_rank
    return false if incoming_rank > current_rank

    incoming_completed = parse_timestamp(attributes["completed_at"])
    if existing.completed_at.present?
      return true if incoming_completed.nil? || incoming_completed < existing.completed_at
    end

    incoming_started = parse_timestamp(attributes["started_at"])
    if existing.completed_at.nil? && existing.started_at.present?
      return true if incoming_started.nil? || incoming_started < existing.started_at
    end

    false
  end

  def parse_timestamp(value)
    return value if value.is_a?(Time) || value.is_a?(ActiveSupport::TimeWithZone)
    return nil if value.blank?

    Time.zone.parse(value.to_s)
  rescue ArgumentError
    nil
  end

  def fetch_runs(url, sha:)
    runs = []
    page = 1
    loop do
      if @app_binding
        data = @app_client.checks(installation: @app_binding.github_app_installation, repository_id: @app_binding.repository_id, full_name: @app_binding.full_name, sha: sha, page: page)
      else
        response = github_get(url, page: page)
        return { runs: [], error: "GitHub checks could not be loaded (HTTP #{response.code})" } unless response.success?

        data = response.parsed_response
      end
      page_runs = Array(data["check_runs"])
      runs.concat(page_runs)
      total_count = data["total_count"]&.to_i || runs.size
      return { runs: [], error: "GitHub returned an incomplete check list" } if page_runs.empty? && runs.size < total_count
      break if runs.size >= total_count

      page += 1
    end
    { runs: runs, error: nil }
  end

  # Only prune rows that already existed before this fetch and were not modified
  # concurrently while provider HTTP was in flight.
  def prune_obsolete_current_commit_runs(runs, target_sha:, locked_existing:, pre_fetch_versions:)
    incoming_ids = runs.map { |attributes| attributes.fetch("id") }.to_set
    prunable_ids = locked_existing.each_with_object([]) do |(external_id, run), ids|
      next if incoming_ids.include?(external_id)
      next if concurrently_modified?(run, pre_fetch_versions[external_id])

      ids << run.id
    end
    return if prunable_ids.empty?

    submission.github_check_runs.where(head_sha: target_sha, id: prunable_ids).delete_all
  end

  def headers
    {
      "Authorization" => "Bearer #{token}",
      "Accept" => "application/vnd.github+json",
      "X-GitHub-Api-Version" => "2022-11-28"
    }
  end

  def github_get(url, page:)
    HTTParty.get(url, headers: headers, query: { filter: "latest", per_page: 100, page: page }, timeout: 15)
  end

  def failure(message)
    { check_runs: [], error: message }
  end
end
