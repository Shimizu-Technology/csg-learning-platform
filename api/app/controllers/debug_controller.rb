class DebugController < ActionController::API
  def auth
    header = request.headers["Authorization"]
    unless header.present?
      render json: { error: "No auth header" }
      return
    end

    token = header.split(" ").last

    begin
      jwks_url = ENV.fetch("CLERK_JWKS_URL", nil)
      jwks_response = HTTParty.get(jwks_url, timeout: 5) if jwks_url
      jwks_ok = jwks_response&.success?

      # Try raw JWT decode without verification first to see claims
      raw_claims = nil
      raw_error = nil
      begin
        raw_claims = JWT.decode(token, nil, false).first
      rescue => e
        raw_error = "#{e.class}: #{e.message}"
      end

      # Try verified decode
      decoded = nil
      verify_error = nil
      begin
        decoded = ClerkAuth.verify(token)
      rescue => e
        verify_error = "#{e.class}: #{e.message}"
      end

      # Check user lookup
      user_info = nil
      if decoded || raw_claims
        claims = decoded || raw_claims
        clerk_id = claims["sub"]
        email = claims["email"] || claims["primary_email_address"]
        user_by_clerk = User.find_by(clerk_id: clerk_id)
        user_by_email = email.present? ? User.find_by("LOWER(email) = ?", email.to_s.downcase) : nil
        user_info = {
          clerk_id_from_jwt: clerk_id,
          email_from_jwt: email,
          user_found_by_clerk_id: user_by_clerk&.id,
          user_found_by_email: user_by_email&.id,
          user_role: (user_by_clerk || user_by_email)&.role
        }
      end

      render json: {
        token_preview: "#{token[0..30]}...",
        jwks_url: jwks_url,
        jwks_fetched: jwks_ok,
        raw_claims: raw_claims,
        raw_error: raw_error,
        verified_claims: decoded,
        verify_error: verify_error,
        user_lookup: user_info,
        rails_env: Rails.env
      }
    rescue => e
      render json: { error: "#{e.class}: #{e.message}", backtrace: e.backtrace.first(5) }
    end
  end
end
