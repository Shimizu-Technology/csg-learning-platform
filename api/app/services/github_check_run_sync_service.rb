class GithubCheckRunSyncService
  GITHUB_API_BASE = "https://api.github.com".freeze

  def initialize(submission:, token:, now: Time.current, app_client: nil)
    @submission = submission
    @token = token
    @now = now
    @app_client = app_client
  end

  def call
    cohort = submission.enrollment&.cohort
    features = FeatureSwitches.for(cohort: cohort)
    return failure("GitHub checks are disabled for this course") unless features["github_sync"]

    owner, repository = repository_coordinates
    return failure("A GitHub repository URL is required before checks can be refreshed") unless owner && repository
    return failure("A commit SHA is required before checks can be refreshed") if submission.commit_sha.blank?

    if cohort && features["github_app"] == true
      @app_binding = GithubRepositoryAccess.binding_for(enrollment: submission.enrollment, curriculum_module_id: submission.content_block.lesson.module_id)
      return failure("Verify a repository binding before refreshing checks") unless @app_binding
      return failure("Submission repository does not match the verified binding") unless @app_binding.full_name.casecmp?("#{owner}/#{repository}")

      @app_client ||= GithubAppClient.new
      GithubRepositoryAccess.new(@app_binding, client: @app_client).repository!
    end

    result = fetch_runs("#{GITHUB_API_BASE}/repos/#{owner}/#{repository}/commits/#{submission.commit_sha}/check-runs")
    return failure(result[:error]) if result[:error]

    runs = result[:runs]
    imported = GithubCheckRun.transaction do
      current = runs.map { |attributes| upsert_run(attributes) }
      prune_obsolete_current_commit_runs(runs)
      current
    end
    { check_runs: imported.sort_by { |run| [ run.completed_at || Time.zone.at(0), run.id ] }.reverse, error: nil }
  rescue GithubRepositoryAccess::BindingChanged => error
    failure(error.message)
  rescue GithubAppClient::Error => error
    GithubRepositoryAccess.new(@app_binding, client: @app_client).fail_current_verification!(error) if @app_binding
    failure(error.message)
  rescue URI::InvalidURIError
    failure("The submission repository URL is invalid")
  rescue StandardError => error
    Rails.logger.warn("GitHub check import failed for submission #{submission.id}: #{error.class.name}")
    failure("GitHub checks are temporarily unavailable")
  end

  private

  attr_reader :submission, :token, :now

  def repository_coordinates
    [ submission.repo_url, submission.pr_url, submission.github_code_url ].compact_blank.each do |value|
      uri = URI.parse(value)
      next unless uri.scheme == "https" && uri.host == "github.com"

      owner, repository = uri.path.split("/").reject(&:blank?).first(2)
      return [ owner, repository&.delete_suffix(".git") ] if owner.present? && repository.present?
    end
    nil
  end

  def upsert_run(attributes)
    run = submission.github_check_runs.find_or_initialize_by(external_id: attributes.fetch("id"))
    run.update!(
      name: attributes.fetch("name"),
      workflow_name: attributes.dig("check_suite", "app", "name"),
      app_slug: attributes.dig("app", "slug"),
      head_sha: attributes.fetch("head_sha"),
      status: attributes.fetch("status"),
      conclusion: attributes["conclusion"],
      details_url: attributes["details_url"],
      started_at: attributes["started_at"],
      completed_at: attributes["completed_at"],
      fetched_at: now
    )
    run
  end

  def fetch_runs(url)
    runs = []
    page = 1
    loop do
      if @app_binding
        data = @app_client.checks(installation: @app_binding.github_app_installation, repository_id: @app_binding.repository_id, full_name: @app_binding.full_name, sha: submission.commit_sha, page: page)
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

  def prune_obsolete_current_commit_runs(runs)
    external_ids = runs.map { |attributes| attributes.fetch("id") }
    scope = submission.github_check_runs.where(head_sha: submission.commit_sha)
    scope = scope.where.not(external_id: external_ids) if external_ids.any?
    scope.delete_all
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
