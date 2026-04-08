class ClerkInvitationService
  BASE_URL = "https://api.clerk.com/v1"

  def initialize
    @secret_key = ENV["CLERK_SECRET_KEY"]
  end

  def configured?
    @secret_key.present?
  end

  def create_invitation(email:, redirect_url: nil, public_metadata: {}, ignore_existing: false)
    raise "CLERK_SECRET_KEY not configured" unless configured?

    body = {
      email_address: email,
      notify: false,
      ignore_existing: ignore_existing
    }
    body[:redirect_url] = redirect_url if redirect_url.present?
    body[:public_metadata] = public_metadata if public_metadata.present?

    response = HTTParty.post(
      "#{BASE_URL}/invitations",
      headers: {
        "Authorization" => "Bearer #{@secret_key}",
        "Content-Type" => "application/json"
      },
      body: body.to_json,
      timeout: 10
    )

    if response.success?
      parsed = response.parsed_response
      Rails.logger.info("Clerk invitation created for #{email}: id=#{parsed['id']}")
      { success: true, invitation_id: parsed["id"], status: parsed["status"], url: parsed["url"] }
    else
      error_message = extract_error_message(response.parsed_response)
      Rails.logger.error("Clerk invitation failed for #{email}: #{error_message}")
      { success: false, error: error_message, status_code: response.code }
    end
  rescue HTTParty::Error, Timeout::Error, Errno::ECONNREFUSED => e
    Rails.logger.error("Clerk invitation network error for #{email}: #{e.message}")
    { success: false, error: "Could not reach Clerk API: #{e.message}" }
  end

  private

  def extract_error_message(error)
    return "Unknown error" unless error.is_a?(Hash)

    if error["errors"].is_a?(Array) && error["errors"].any?
      error["errors"].map { |e| e["long_message"] || e["message"] }.join("; ")
    else
      error["message"] || error.to_s
    end
  end
end
