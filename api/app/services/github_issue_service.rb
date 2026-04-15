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

      cohort = user.cohorts.active.first
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
            comment: feedback.present? ? "Graded **#{grade}** - #{feedback}" : "Graded **#{grade}** - Passing!"
          )
        end
      end
    rescue StandardError => e
      Rails.logger.error("[GithubIssueService] handle_grade error: #{e.message}")
      nil
    end

    private

    def handle_redo_grade(submission, user, repo, lesson, content_block, feedback, token)
      title = "Redo: #{content_block.title || lesson.title}"

      if submission.github_issue_url.blank? && feedback.present?
        body = build_issue_body(content_block, lesson, feedback)
        result = create_issue(
          owner: user.github_username, repo: repo,
          title: title, body: body, token: token
        )
        if result[:github_issue_url]
          submission.update_column(:github_issue_url, result[:github_issue_url])
        end
      elsif submission.github_issue_url.present?
        comment = feedback.present? ? "**Redo requested again**\n\n#{feedback}" : "**Redo requested again** — please review and resubmit."
        add_comment(
          issue_url: submission.github_issue_url,
          body: comment, token: token
        )
      else
        Rails.logger.info("[GithubIssueService] R grade with no feedback and no existing issue; skipping GitHub issue creation")
      end
    end

    # When a student resubmits, the new Submission has no github_issue_url.
    # Look up the most recent prior submission for the same user + content_block
    # that has a github_issue_url, so we can close it on a passing grade.
    def find_prior_issue_url(submission)
      Submission
        .where(user: submission.user, content_block: submission.content_block)
        .where.not(github_issue_url: [ nil, "" ])
        .order(created_at: :desc)
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

    def headers(token)
      {
        "Authorization" => "Bearer #{token}",
        "Accept" => "application/vnd.github+json",
        "X-GitHub-Api-Version" => "2022-11-28"
      }
    end

    def github_get(url, token)
      HTTParty.get(url, headers: headers(token), timeout: 10)
    end

    def github_post(url, token, body)
      HTTParty.post(url, headers: headers(token), body: body.to_json, timeout: 10)
    end

    def github_patch(url, token, body)
      HTTParty.patch(url, headers: headers(token), body: body.to_json, timeout: 10)
    end
  end
end
