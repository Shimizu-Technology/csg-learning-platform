class ClerkWebHandoffService
  ENDPOINT = "https://api.clerk.com/v1/sign_in_tokens"
  TOKEN_LIFETIME_SECONDS = 60
  GENERIC_ERROR = "Could not create a secure web handoff"

  def initialize(secret_key: ENV["CLERK_SECRET_KEY"])
    @secret_key = secret_key
  end

  def create(user_id:, redirect_url:)
    return failure if @secret_key.blank?

    response = HTTParty.post(
      ENDPOINT,
      headers: {
        "Authorization" => "Bearer #{@secret_key}",
        "Content-Type" => "application/json"
      },
      body: { user_id: user_id, expires_in_seconds: TOKEN_LIFETIME_SECONDS }.to_json,
      timeout: 10
    )
    unless response.success?
      Rails.logger.warn("Clerk web handoff rejected: status=#{response.code}")
      return failure
    end

    payload = response.parsed_response
    portal_url = payload.is_a?(Hash) ? payload["url"].to_s : ""
    return failure if portal_url.blank?

    uri = URI.parse(portal_url)
    return failure unless uri.is_a?(URI::HTTPS) && uri.host.present?

    query = URI.decode_www_form(uri.query.to_s).reject { |key, _value| key == "redirect_url" }
    uri.query = URI.encode_www_form(query << [ "redirect_url", redirect_url ])
    { success: true, url: uri.to_s }
  rescue HTTParty::Error, Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError, URI::InvalidURIError => error
    Rails.logger.warn("Clerk web handoff unavailable: #{error.class.name}")
    failure
  end

  private

  def failure
    { success: false, error: GENERIC_ERROR }
  end
end
