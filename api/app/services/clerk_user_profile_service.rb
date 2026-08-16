class ClerkUserProfileService
  BASE_URL = "https://api.clerk.com/v1/users"

  def fetch(issuer:, clerk_user_id:)
    environment = ClerkEnvironment.for_issuer(issuer)
    return nil if environment&.secret_key.blank?
    return nil unless clerk_user_id.to_s.match?(/\A[a-zA-Z0-9_-]+\z/)

    response = HTTParty.get(
      "#{BASE_URL}/#{CGI.escapeURIComponent(clerk_user_id)}",
      headers: { "Authorization" => "Bearer #{environment.secret_key}" },
      timeout: 5
    )
    return nil unless response.success?

    parse(response.parsed_response)
  rescue HTTParty::Error, Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError => error
    Rails.logger.warn("[ClerkProfile] lookup_failed error_class=#{error.class.name}")
    nil
  end

  private

  def parse(payload)
    return nil unless payload.is_a?(Hash)

    emails = Array(payload["email_addresses"])
    primary_email_id = payload["primary_email_address_id"].to_s.presence
    return nil unless primary_email_id

    primary = emails.find { |email| email["id"] == primary_email_id }
    return nil unless primary.is_a?(Hash)

    {
      email: primary["email_address"].to_s.strip.downcase.presence,
      email_verified: primary.dig("verification", "status") == "verified",
      first_name: payload["first_name"].presence,
      last_name: payload["last_name"].presence,
      external_id: payload["external_id"].presence
    }
  end
end
