class GithubOrganizationAccessService
  class Unavailable < StandardError; end

  PAGE_SIZE = 100
  MAX_PAGES = 20

  def initialize(organization:, token:, client: HTTParty)
    @organization = organization.to_s.strip
    @token = token.to_s
    @client = client
  end

  def status_for(users)
    raise Unavailable, "GitHub organization is not configured" unless @organization.match?(/\A[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?\z/i)
    raise Unavailable, "GitHub organization access is not configured" if @token.blank?

    members = fetch_pages("members").filter_map { |entry| entry["login"]&.downcase }.to_set
    invitations = fetch_pages("invitations")
    invited_logins = invitations.filter_map { |entry| entry["login"]&.downcase }.to_set
    invited_emails = invitations.filter_map { |entry| entry["email"]&.downcase }.to_set

    users.to_h do |user|
      login = user.github_username.to_s.strip.downcase
      state = if login.present? && members.include?(login)
        "member"
      elsif invited_logins.include?(login) || invited_emails.include?(user.email.to_s.downcase)
        "invited"
      elsif login.blank?
        "username_missing"
      else
        "not_invited"
      end
      [ user.id, state ]
    end
  end

  private

  def fetch_pages(resource)
    entries = []
    1.upto(MAX_PAGES) do |page|
      response = @client.get(
        "https://api.github.com/orgs/#{@organization}/#{resource}",
        headers: {
          "Authorization" => "Bearer #{@token}",
          "Accept" => "application/vnd.github+json",
          "X-GitHub-Api-Version" => "2022-11-28"
        },
        query: { per_page: PAGE_SIZE, page: page },
        timeout: 8
      )
      raise Unavailable, "GitHub returned #{response.code}" unless response.code == 200
      raise Unavailable, "GitHub returned an unexpected response" unless response.parsed_response.is_a?(Array)

      batch = response.parsed_response
      entries.concat(batch)
      return entries if batch.length < PAGE_SIZE
    end
    raise Unavailable, "GitHub organization list exceeded the page limit"
  rescue Unavailable
    raise
  rescue StandardError
    raise Unavailable, "GitHub request failed"
  end
end
