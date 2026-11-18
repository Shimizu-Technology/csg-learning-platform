require "base64"

# User-to-server authorization proves identity once. User/refresh tokens are
# used only in memory to read /user, never persisted or returned to the browser.
class GithubUserAuthorizationClient
  def initialize(transport: HTTParty, credentials: GithubAppCredentials)
    @transport, @credentials = transport, credentials
  end

  def authorization_url(state:, code_challenge:)
    ensure_configured!
    query = URI.encode_www_form(client_id: @credentials.client_id, redirect_uri: @credentials.user_callback_url,
      state: state, code_challenge: code_challenge, code_challenge_method: "S256", allow_signup: "false", prompt: "select_account")
    "https://github.com/login/oauth/authorize?#{query}"
  end

  def identity(code:, code_verifier:)
    ensure_configured!
    raise GithubAppClient::Error, "GitHub authorization code is missing; connect again" unless code.is_a?(String) && code.bytesize.between?(1, 512)

    token_data = request(:post, "https://github.com/login/oauth/access_token", headers: { "Accept" => "application/json" },
      body: { client_id: @credentials.client_id, client_secret: @credentials.client_secret, code: code,
        redirect_uri: @credentials.user_callback_url, code_verifier: code_verifier })
    raise GithubAppClient::Error, "That GitHub link expired. Connect again." if token_data.key?("error")

    token = token_data.fetch("access_token")
    unless token.is_a?(String) && token.present? && token_data.fetch("token_type").to_s.casecmp?("bearer")
      raise GithubAppClient::Error, "GitHub authorization failed; connect again"
    end
    person = request(:get, "https://api.github.com/user", headers: { "Authorization" => "Bearer #{token}", "Accept" => "application/vnd.github+json", "X-GitHub-Api-Version" => "2022-11-28" })
    id = person.fetch("id").to_s
    login = person.fetch("login")
    unless id.match?(/\A[1-9]\d{0,18}\z/) && id.to_i <= 9_223_372_036_854_775_807 && login.is_a?(String) && login.match?(/\A[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\z/) && person.fetch("type") == "User"
      raise GithubAppClient::Error, "GitHub returned an invalid personal identity; connect again"
    end
    { id: id, login: login }
  rescue GithubAppClient::Error
    raise
  rescue StandardError
    raise GithubAppClient::Error, GithubAppClient::PROVIDER_ERROR
  ensure
    revoke_token(token) if token.is_a?(String) && token.present?
  end

  private

  # Revoke only this ephemeral user token, not the App grant/installation.
  # Provider failures must not mask a successful identity proof or leak details.
  def revoke_token(token)
    @transport.delete("https://api.github.com/applications/#{URI.encode_www_form_component(@credentials.client_id)}/token",
      basic_auth: { username: @credentials.client_id, password: @credentials.client_secret },
      headers: { "Accept" => "application/vnd.github+json", "Content-Type" => "application/json", "X-GitHub-Api-Version" => "2022-11-28" },
      body: { access_token: token }.to_json, timeout: 10)
  rescue StandardError
    nil
  end

  def ensure_configured!
    raise GithubAppClient::Error, "GitHub user authorization is not configured" unless @credentials.oauth_configured?
  end

  def request(method, url, **options)
    response = @transport.public_send(method, url, **options, timeout: 10)
    raise GithubAppClient::Error, "GitHub authorization is unavailable; connect again" unless response.success?

    value = response.parsed_response
    raise GithubAppClient::Error, GithubAppClient::PROVIDER_ERROR unless value.is_a?(Hash)

    value
  end
end
