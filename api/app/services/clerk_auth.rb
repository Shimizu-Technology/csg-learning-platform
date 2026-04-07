class ClerkAuth
  JWKS_CACHE_KEY = "clerk_jwks"
  JWKS_CACHE_TTL = 1.hour

  class << self
    def verify(token)
      return nil if token.blank?

      # DEV_BYPASS mode: skip JWT verification in development
      if dev_bypass?
        return dev_bypass_payload
      end

      # Test environment: allow special test tokens
      if Rails.env.test? && token.start_with?("test_token_")
        return handle_test_token(token)
      end

      jwks = fetch_jwks
      return nil if jwks.nil?

      decode_options = {
        algorithms: [ "RS256" ],
        jwks: jwks
      }

      issuer = expected_issuer
      if issuer.present?
        decode_options[:verify_iss] = true
        decode_options[:iss] = issuer
      elsif Rails.env.production?
        Rails.logger.error("CLERK_ISSUER is required in production for JWT issuer verification")
        return nil
      end

      audience = expected_audience
      if audience.present?
        decode_options[:verify_aud] = true
        decode_options[:aud] = audience
      end

      decoded = JWT.decode(token, nil, true, decode_options)

      decoded.first
    rescue JWT::DecodeError => e
      Rails.logger.warn("JWT decode error: #{e.message}")
      nil
    rescue JWT::ExpiredSignature
      Rails.logger.debug("JWT token expired")
      nil
    end

    def dev_bypass?
      ENV["DEV_BYPASS"] == "true" && (Rails.env.development? || Rails.env.test?)
    end

    private

    def dev_bypass_payload
      {
        "sub" => "dev_user_clerk_id",
        "email" => "leon@anyonecanlearntocode.com",
        "first_name" => "Leon",
        "last_name" => "Shimizu"
      }
    end

    def fetch_jwks
      cached = Rails.cache.read(JWKS_CACHE_KEY)
      return cached if cached.present?

      jwks_uri = jwks_url
      return nil unless jwks_uri

      response = HTTParty.get(jwks_uri, timeout: 5)

      if response.success?
        jwks = response.parsed_response
        Rails.cache.write(JWKS_CACHE_KEY, jwks, expires_in: JWKS_CACHE_TTL)
        jwks
      else
        Rails.logger.error("Failed to fetch Clerk JWKS: #{response.code}")
        nil
      end
    rescue HTTParty::Error, Timeout::Error => e
      Rails.logger.error("Error fetching Clerk JWKS: #{e.message}")
      nil
    end

    def jwks_url
      jwks = ENV.fetch("CLERK_JWKS_URL", nil)
      return jwks if jwks.present?

      issuer = ENV.fetch("CLERK_ISSUER", nil)
      if issuer.present?
        "#{issuer}/.well-known/jwks.json"
      else
        Rails.logger.warn("Neither CLERK_JWKS_URL nor CLERK_ISSUER configured")
        nil
      end
    end

    def expected_issuer
      ENV.fetch("CLERK_ISSUER", nil)
    end

    def expected_audience
      raw = ENV.fetch("CLERK_AUDIENCE", nil)
      return nil if raw.blank?

      audiences = raw.split(",").map(&:strip).reject(&:empty?)
      audiences.length == 1 ? audiences.first : audiences
    end

    def handle_test_token(token)
      user_id = token.gsub("test_token_", "")
      user = User.find_by(id: user_id)

      if user
        {
          "sub" => user.clerk_id || "test_clerk_#{user.id}",
          "email" => user.email,
          "first_name" => user.first_name,
          "last_name" => user.last_name
        }
      end
    end
  end
end
