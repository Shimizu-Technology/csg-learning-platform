class GithubIssueService
  GITHUB_API_BASE = "https://api.github.com".freeze

  class << self
    def fetch_issue_with_comments(issue_url:, token:)
      path = issue_url.delete_prefix("https://github.com/")
      api_url = "#{GITHUB_API_BASE}/repos/#{path}"

      issue_response = github_get(api_url, token)
      unless issue_response.success?
        return { error: "Failed to fetch issue: HTTP #{issue_response.code}" }
      end

      issue = issue_response.parsed_response
      comments_response = github_get("#{api_url}/comments", token)
      comments = if comments_response.success?
        comments_response.parsed_response.map do |c|
          {
            id: c["id"],
            user: c.dig("user", "login"),
            body: c["body"],
            created_at: c["created_at"],
            updated_at: c["updated_at"]
          }
        end
      else
        []
      end

      {
        title: issue["title"],
        body: issue["body"],
        state: issue["state"],
        created_at: issue["created_at"],
        html_url: issue["html_url"],
        comments: comments,
        error: nil
      }
    rescue StandardError => e
      { error: "GitHub request failed: #{e.message}" }
    end

    # Creates a new GitHub issue on the student's repo.
    # Returns { github_issue_url: "https://..." } or { error: "..." }
    def create_issue(owner:, repo:, title:, body:, token:)
      api_url = "#{GITHUB_API_BASE}/repos/#{owner}/#{repo}/issues"
      response = github_post(api_url, token, { title: title, body: body })

      if response.success? && response.parsed_response["html_url"]
        { github_issue_url: response.parsed_response["html_url"] }
      else
        { error: "Failed to create issue: #{response.parsed_response['message'] || "HTTP #{response.code}"}" }
      end
    rescue StandardError => e
      { error: "GitHub request failed: #{e.message}" }
    end

    # Adds a comment to an existing GitHub issue.
    def add_comment(issue_url:, body:, token:)
      path = issue_url.delete_prefix("https://github.com/")
      api_url = "#{GITHUB_API_BASE}/repos/#{path}/comments"
      response = github_post(api_url, token, { body: body })

      if response.success?
        { success: true }
      else
        { error: "Failed to add comment: #{response.parsed_response['message'] || "HTTP #{response.code}"}" }
      end
    rescue StandardError => e
      { error: "GitHub request failed: #{e.message}" }
    end

    # Closes a GitHub issue (e.g., when a previously R-graded submission passes).
    def close_issue(issue_url:, token:, comment: nil)
      path = issue_url.delete_prefix("https://github.com/")
      api_url = "#{GITHUB_API_BASE}/repos/#{path}"

      if comment.present?
        add_comment(issue_url: issue_url, body: comment, token: token)
      end

      response = github_patch(api_url, token, { state: "closed", state_reason: "completed" })

      if response.success?
        { success: true }
      else
        { error: "Failed to close issue: #{response.parsed_response['message'] || "HTTP #{response.code}"}" }
      end
    rescue StandardError => e
      { error: "GitHub request failed: #{e.message}" }
    end

    # Handles the full issue lifecycle when grading a submission.
    # Called from SubmissionsController#grade.
    def handle_grade(submission:, grade:, feedback:, token:)
      return nil if token.blank?

      user = submission.user
      return nil if user.github_username.blank?

      cohort = submission.enrollment&.cohort || user.cohorts.active.first
      return nil unless cohort

      content_block = submission.content_block
      lesson = content_block.lesson
      repo = resolve_repo(cohort, lesson.curriculum_module)

      if grade == "R"
        handle_redo_grade(submission, user, repo, lesson, content_block, feedback, token)
      else
        issue_url = submission.github_issue_url.presence || find_prior_issue_url(submission)
        if issue_url.present?
          close_issue(
            issue_url: issue_url,
            token: token,
            comment: feedback.present? ? "Graded **#{Submission.grade_label(grade)}** - #{feedback}" : "Graded **#{Submission.grade_label(grade)}** - Passing!"
          )
        end
      end
    rescue StandardError => e
      Rails.logger.error("[GithubIssueService] handle_grade error: #{e.message}")
      nil
    end

    # The one rule for whether a Redo's feedback goes to GitHub as an issue. The review's
    # warning (redo_posts_to_github), the grade writer and the delivery drain all use it, so
    # an instructor is warned exactly when feedback will be posted, and never otherwise.
    #
    # Only work synced from GitHub (prework_github_sync) in a cohort whose effective
    # github_sync is on qualifies; text and URL exercises keep Redo feedback in Learn.
    def redo_issue_allowed?(submission)
      cohort = redo_issue_cohort(submission)
      return false unless cohort && FeatureSwitches.for(cohort: cohort)["github_sync"] == true

      submission.effective_submission_type == "prework_github_sync"
    end

    # :v2 (a durable delivery to a verified GitHub App binding), :legacy (the organization
    # token path in handle_grade, with a repository or earlier issue to post to) or nil.
    # Reads saved state only; never calls GitHub.
    def redo_issue_route(submission, token: ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"])
      return nil unless redo_issue_allowed?(submission)

      cohort = redo_issue_cohort(submission)
      if GithubIssueDeliveryPlanner.enabled_for?(cohort)
        return nil unless submission.enrollment

        binding = GithubRepositoryAccess.binding_for(enrollment: submission.enrollment, curriculum_module_id: submission.content_block.lesson.module_id)
        return binding&.verification_state == "verified" && binding.repository_id.present? ? :v2 : nil
      end
      return nil if token.blank? || submission.user.github_username.blank?

      legacy_target = submission.github_issue_url.present? ||
        resolve_repo(cohort, submission.content_block.lesson.curriculum_module).present? ||
        find_prior_issue_url(submission).present?
      legacy_target ? :legacy : nil
    end

    private

    def redo_issue_cohort(submission)
      submission.enrollment&.cohort || submission.user.cohorts.active.first
    end

    def handle_redo_grade(submission, user, repo, lesson, content_block, feedback, token)
      title = "Redo: #{content_block.display_title}"
      existing_url = submission.github_issue_url.presence || find_prior_issue_url(submission)

      if existing_url.present?
        comment = feedback.present? ? "**Redo requested again**\n\n#{feedback}" : "**Redo requested again** — please review and resubmit."
        add_comment(issue_url: existing_url, body: comment, token: token)
      elsif feedback.present?
        body = build_issue_body(content_block, lesson, feedback)
        result = create_issue(
          owner: user.github_username, repo: repo,
          title: title, body: body, token: token
        )
        if result[:github_issue_url]
          submission.update_column(:github_issue_url, result[:github_issue_url])
        end
      else
        Rails.logger.info("[GithubIssueService] R grade with no feedback and no existing issue; skipping GitHub issue creation")
      end
    end

    # When a student resubmits, the new Submission has no github_issue_url.
    # Look up the most recent prior submission for the same enrollment + content_block
    # (falling back to user + content_block only for legacy rows without an enrollment)
    # that has a github_issue_url, so we can close or comment on it safely.
    def find_prior_issue_url(submission)
      scope = if submission.enrollment_id.present?
        Submission.where(enrollment_id: submission.enrollment_id, content_block_id: submission.content_block_id)
      else
        Submission.where(user: submission.user, content_block: submission.content_block)
      end

      scope
        .where.not(github_issue_url: [ nil, "" ])
        .order(created_at: :desc, id: :desc)
        .pick(:github_issue_url)
    end

    def build_issue_body(content_block, lesson, feedback)
      parts = []
      parts << "**Exercise:** #{content_block.title}" if content_block.title.present?
      parts << "**Lesson:** #{lesson.title}"
      parts << ""
      parts << "### Feedback"
      parts << feedback.to_s
      parts.join("\n")
    end

    def resolve_repo(cohort, curriculum_module)
      module_config = (cohort.settings || {}).dig("module_github_config", curriculum_module.id.to_s)
      (module_config && module_config["repository_name"].presence) || cohort.repository_name
    end

    def read_headers(token)
      {
        "Authorization" => "Bearer #{token}",
        "Accept" => "application/vnd.github+json",
        "X-GitHub-Api-Version" => "2022-11-28"
      }
    end

    def write_headers(token)
      read_headers(token).merge("Content-Type" => "application/json")
    end

    def github_get(url, token)
      HTTParty.get(url, headers: read_headers(token), timeout: 10)
    end

    def github_post(url, token, body)
      HTTParty.post(url, headers: write_headers(token), body: body.to_json, timeout: 10)
    end

    def github_patch(url, token, body)
      HTTParty.patch(url, headers: write_headers(token), body: body.to_json, timeout: 10)
    end
  end
end
