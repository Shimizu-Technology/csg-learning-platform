require "digest"

class ClerkAuth
  JWKS_CACHE_TTL = 1.hour
  MAX_TOKEN_BYTES = 16.kilobytes

  class << self
    def verify(token)
      return nil if token.blank? || token.bytesize > MAX_TOKEN_BYTES

      # Test environment: allow special test tokens
      if Rails.env.test? && token.start_with?("test_token_")
        return handle_test_token(token)
      end

      unverified_payload = JWT.decode(token, nil, false).first
      environment = ClerkEnvironment.for_issuer(unverified_payload["iss"])
      unless environment
        Rails.logger.warn("[ClerkAuth] rejected_unrecognized_issuer")
        return nil
      end

      jwks = fetch_jwks(environment)
      return nil if jwks.nil?

      decode_options = {
        algorithms: [ "RS256" ],
        jwks: jwks,
        verify_iss: true,
        iss: environment.issuer
      }
      if environment.audience.present?
        decode_options[:verify_aud] = true
        decode_options[:aud] = environment.audience
      end

      decoded = JWT.decode(token, nil, true, decode_options).first
      return nil unless authorized_party_allowed?(decoded, environment)

      decoded["_clerk_issuer"] = environment.issuer
      decoded["_clerk_environment"] = environment.name
      decoded
    rescue JWT::ExpiredSignature
      Rails.logger.debug("[ClerkAuth] token_expired")
      nil
    rescue JWT::DecodeError => error
      Rails.logger.warn("[ClerkAuth] decode_error error_class=#{error.class.name}")
      nil
    end

    private

    def fetch_jwks(environment)
      cache_key = "clerk_jwks:#{Digest::SHA256.hexdigest(environment.issuer)[0, 16]}"
      cached = Rails.cache.read(cache_key)
      return cached if cached.present?

      response = HTTParty.get(environment.jwks_url, timeout: 5)

      if response.success?
        jwks = response.parsed_response
        Rails.cache.write(cache_key, jwks, expires_in: JWKS_CACHE_TTL)
        jwks
      else
        Rails.logger.error("[ClerkAuth] jwks_fetch_failed status_code=#{response.code}")
        nil
      end
    rescue HTTParty::Error, Net::OpenTimeout, Net::ReadTimeout, Timeout::Error, SocketError, Errno::ECONNREFUSED, OpenSSL::SSL::SSLError => error
      Rails.logger.error("[ClerkAuth] jwks_unavailable error_class=#{error.class.name}")
      nil
    end

    def authorized_party_allowed?(payload, environment)
      authorized_party = payload["azp"].presence
      allowed = environment.authorized_parties
      # Clerk's manual verification guidance says to validate azp when present
      # and skip this check when the claim is absent. Native session tokens may
      # not have a browser Origin, while browser tokens must match the allowlist.
      return true if authorized_party.blank? || allowed.blank?
      return true if allowed.include?(authorized_party)

      Rails.logger.warn("[ClerkAuth] rejected_authorized_party environment=#{environment.name}")
      false
    end

    def handle_test_token(token)
      user_id = token.delete_prefix("test_token_")
      user = User.find_by(id: user_id)
      return nil unless user

      environment = ClerkEnvironment.primary
      {
        "sub" => user.clerk_id || "test_clerk_#{user.id}",
        "email" => user.email,
        "first_name" => user.first_name,
        "last_name" => user.last_name,
        "_clerk_issuer" => environment&.issuer || "https://test.clerk.invalid",
        "_clerk_environment" => environment&.name || "test"
      }
    end
  end
end
