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

    fetched_sha = target_sha
    pre_fetch_versions = submission.github_check_runs
      .where(head_sha: fetched_sha)
      .pluck(:id, :updated_at, :status, :conclusion, :completed_at)
      .each_with_object({}) do |(id, updated_at, status, conclusion, completed_at), versions|
        versions[id] = {
          updated_at: updated_at,
          status: status,
          conclusion: conclusion,
          completed_at: completed_at
        }
      end

    result = fetch_runs("#{GITHUB_API_BASE}/repos/#{owner}/#{repository}/commits/#{fetched_sha}/check-runs", sha: fetched_sha)
    return failure(result[:error]) if result[:error]

    runs = result[:runs]
    merged = GithubCheckRunMerger.sync_snapshot!(
      submission: submission,
      runs: runs,
      fetched_at: now,
      pre_fetch_versions: pre_fetch_versions,
      fetched_sha: fetched_sha
    )
    return merged if merged[:error]

    suggestion = if cohort && features["github_app"] == true && features["github_grade_suggestions"] == true
      begin
        GithubGradeSuggestionEvaluator.evaluate_submission!(submission, now: Time.current)
      rescue StandardError => error
        Rails.logger.warn("GitHub grade suggestion evaluation failed for submission #{submission.id}: #{error.class.name}")
        nil
      end
    end
    merged.merge(grade_suggestion: suggestion)
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
