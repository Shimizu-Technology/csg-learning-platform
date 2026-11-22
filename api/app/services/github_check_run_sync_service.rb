class GithubCheckRunSyncService
  GITHUB_API_BASE = "https://api.github.com".freeze

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
    return failure("A commit SHA is required before checks can be refreshed") if submission.commit_sha.blank?

    if cohort && features["github_app"] == true
      @app_binding = GithubRepositoryAccess.binding_for(enrollment: submission.enrollment, curriculum_module_id: submission.content_block.lesson.module_id)
      return failure("Verify a repository binding before refreshing checks") unless @app_binding
      return failure("Submission repository does not match the verified binding") unless @app_binding.full_name.casecmp?("#{owner}/#{repository}")

      @app_client ||= GithubAppClient.new
      @repository_access = GithubRepositoryAccess.new(@app_binding, client: @app_client)
      @repository_access.repository!
    end

    pre_fetch_versions = submission.github_check_runs
      .where(head_sha: submission.commit_sha)
      .pluck(:id, :updated_at)
      .to_h

    result = fetch_runs("#{GITHUB_API_BASE}/repos/#{owner}/#{repository}/commits/#{submission.commit_sha}/check-runs")
    return failure(result[:error]) if result[:error]

    runs = result[:runs]
    imported = GithubCheckRunMerger.sync_snapshot!(
      submission: submission,
      runs: runs,
      fetched_at: now,
      pre_fetch_versions: pre_fetch_versions
    )
    { check_runs: imported, error: nil }
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

  def repository_coordinates
    full_name = GithubCheckRunMerger.submission_repository_full_name(submission)
    full_name&.split("/", 2)
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
