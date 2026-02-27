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
      
      # Try to fetch JWKS
      jwks_response = HTTParty.get(jwks_url, timeout: 5) if jwks_url
      jwks_ok = jwks_response&.success?
      
      # Try to decode
      decoded = nil
      error_msg = nil
      begin
        decoded = ClerkAuth.verify(token)
      rescue => e
        error_msg = "#{e.class}: #{e.message}"
      end
      
      render json: {
        token_preview: "#{token[0..20]}...",
        jwks_url: jwks_url,
        jwks_fetched: jwks_ok,
        decoded: decoded,
        decode_error: error_msg,
        rails_env: Rails.env,
        dev_bypass: ClerkAuth.dev_bypass?
      }
    rescue => e
      render json: { error: "#{e.class}: #{e.message}" }
    end
  end
end
