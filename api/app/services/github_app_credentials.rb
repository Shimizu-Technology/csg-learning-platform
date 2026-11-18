class GithubAppCredentials
  def self.value(key)
    ENV["GITHUB_APP_#{key.to_s.upcase}"].presence || Rails.application.credentials.dig(:github_app, key)
  end

  def self.app_id = value(:id).to_s
  def self.slug = value(:slug).to_s
  def self.private_key = value(:private_key).to_s.gsub('\\n', "\n")
  def self.client_id = value(:client_id).to_s
  def self.client_secret = value(:client_secret).to_s
  def self.user_callback_url
    value(:user_callback_url).presence || "#{ENV.fetch('FRONTEND_URL', 'http://localhost:5173').delete_suffix('/')}/github-app/authorize"
  end

  def self.oauth_configured?
    uri = URI.parse(user_callback_url)
    safe_origin = uri.scheme == "https" || (!Rails.env.production? && uri.scheme == "http" && %w[localhost 127.0.0.1].include?(uri.host))
    client_id.present? && client_secret.present? && safe_origin && uri.host.present? && uri.userinfo.nil? && uri.query.nil? && uri.fragment.nil? && uri.path == "/github-app/authorize"
  rescue URI::InvalidURIError
    false
  end

  def self.configured? = app_id.match?(/\A[1-9]\d*\z/) && slug.match?(/\A[a-zA-Z0-9-]+\z/) && private_key.present?
end
