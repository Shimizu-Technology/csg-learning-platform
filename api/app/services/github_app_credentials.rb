class GithubAppCredentials
  def self.value(key)
    ENV["GITHUB_APP_#{key.to_s.upcase}"].presence || Rails.application.credentials.dig(:github_app, key)
  end

  def self.app_id = value(:id).to_s
  def self.slug = value(:slug).to_s
  def self.private_key = value(:private_key).to_s.gsub('\\n', "\n")
  def self.configured? = app_id.match?(/\A[1-9]\d*\z/) && slug.match?(/\A[a-zA-Z0-9-]+\z/) && private_key.present?
end
