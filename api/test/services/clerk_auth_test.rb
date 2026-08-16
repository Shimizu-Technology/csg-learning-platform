require "test_helper"

class ClerkAuthTest < ActiveSupport::TestCase
  setup do
    @private_key = OpenSSL::PKey::RSA.generate(2048)
    @jwk = JWT::JWK.new(@private_key).export
  end

  test "verifies a token against the JWKS selected by its exact issuer" do
    with_clerk_env do
      token = token_for(issuer: "https://prod.clerk.test", authorized_party: "https://learn.codeschoolofguam.com")
      response = Struct.new(:parsed_response) { def success? = true }.new({ "keys" => [ @jwk ] })

      with_http_get(response) do
        payload = ClerkAuth.verify(token)
        assert_equal "prod_subject", payload["sub"]
        assert_equal "https://prod.clerk.test", payload["_clerk_issuer"]
        assert_equal "production", payload["_clerk_environment"]
      end
    end
  end

  test "rejects an issuer outside the configured allowlist" do
    with_clerk_env do
      token = token_for(issuer: "https://attacker.example")
      assert_nil ClerkAuth.verify(token)
    end
  end

  test "rejects an unexpected authorized party after signature verification" do
    with_clerk_env do
      token = token_for(issuer: "https://prod.clerk.test", authorized_party: "https://evil.codeschoolofguam.com")
      response = Struct.new(:parsed_response) { def success? = true }.new({ "keys" => [ @jwk ] })

      with_http_get(response) do
        assert_nil ClerkAuth.verify(token)
      end
    end
  end

  private

  def token_for(issuer:, authorized_party: nil)
    now = Time.current.to_i
    payload = { "sub" => "prod_subject", "iss" => issuer, "iat" => now, "nbf" => now - 1, "exp" => now + 60 }
    payload["azp"] = authorized_party if authorized_party
    JWT.encode(payload, @private_key, "RS256", { kid: @jwk.fetch(:kid) })
  end

  def with_clerk_env
    keys = {
      "CLERK_ISSUER" => nil,
      "CLERK_DEVELOPMENT_ISSUER" => "https://dev.clerk.test",
      "CLERK_PRODUCTION_ISSUER" => "https://prod.clerk.test",
      "CLERK_PRODUCTION_AUTHORIZED_PARTIES" => "https://learn.codeschoolofguam.com"
    }
    original = keys.to_h { |key, _value| [ key, ENV[key] ] }
    keys.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
    Rails.cache.clear
    yield
  ensure
    Rails.cache.clear
    original.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end


  def with_http_get(response)
    original = HTTParty.method(:get)
    HTTParty.define_singleton_method(:get) { |_url, **_options| response }
    yield
  ensure
    HTTParty.define_singleton_method(:get, original)
  end
end
