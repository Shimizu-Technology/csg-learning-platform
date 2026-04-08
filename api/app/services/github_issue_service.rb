class GithubIssueService
  GITHUB_API_BASE = "https://api.github.com".freeze

  # Fetches a GitHub issue and its comments using the REST API.
  # issue_url should be a full GitHub URL like "https://github.com/owner/repo/issues/42"
  def self.fetch_issue_with_comments(issue_url:, token:)
    path = issue_url
      .delete_prefix("https://github.com/")
      .sub("/issues/", "/issues/")

    api_url = "#{GITHUB_API_BASE}/repos/#{path}"
    headers = {
      "Authorization" => "Bearer #{token}",
      "Accept" => "application/vnd.github+json",
      "X-GitHub-Api-Version" => "2022-11-28"
    }

    issue_response = HTTParty.get(api_url, headers: headers, timeout: 10)
    unless issue_response.success?
      return { error: "Failed to fetch issue: HTTP #{issue_response.code}" }
    end

    issue = issue_response.parsed_response

    comments_response = HTTParty.get("#{api_url}/comments", headers: headers, timeout: 10)
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
end
