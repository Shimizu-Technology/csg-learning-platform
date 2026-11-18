require "test_helper"

class GithubUserAuthorizationClientTest < ActiveSupport::TestCase
  Credentials = Struct.new(:client_id, :client_secret, :user_callback_url) do
    def oauth_configured? = true
  end
  Response = Struct.new(:parsed_response) do
    def success? = true
  end
  class Transport
    attr_reader :calls
    attr_accessor :token_body, :person_body, :revocation_failure, :user_failure
    def initialize
      @calls = []
      @token_body = { "access_token" => "synthetic-oauth-token", "token_type" => "bearer", "refresh_token" => "synthetic-refresh" }
      @person_body = { "id" => 24680, "login" => "app-learner", "type" => "User" }
    end
    def post(url, **options)
      @calls << [ url, options ]
      Response.new(token_body)
    end
    def get(url, **options)
      @calls << [ url, options ]
      raise user_failure if user_failure
      Response.new(person_body)
    end
    def delete(url, **options)
      @calls << [ url, options ]
      raise revocation_failure if revocation_failure
      Response.new(nil) # successful DELETE is 204 with no body
    end
  end
  setup do
    @transport = Transport.new
    @client = GithubUserAuthorizationClient.new(transport: @transport, credentials: Credentials.new("client-id", "synthetic-secret", "https://learn.codeschoolofguam.com/github-app/authorize"))
  end
  test "OAuth uses S256 PKCE callback and server secret and returns identity only" do
    url = URI(@client.authorization_url(state: "signed-state", code_challenge: "challenge"))
    assert_equal "github.com", url.host
    assert_equal "S256", URI.decode_www_form(url.query).to_h.fetch("code_challenge_method")
    assert_not_includes url.to_s, "synthetic-secret"
    assert_equal({ id: "24680", login: "app-learner" }, @client.identity(code: "code", code_verifier: "verifier"))
    exchange = @transport.calls.first.last.fetch(:body)
    assert_equal "synthetic-secret", exchange.fetch(:client_secret)
    assert_equal "verifier", exchange.fetch(:code_verifier)
    assert_equal "Bearer synthetic-oauth-token", @transport.calls[1].last.fetch(:headers).fetch("Authorization")
  end
  test "bad authorization codes explain consumed nonce recovery without leaking provider details" do
    @transport.token_body = { "error" => "bad_verification_code", "error_description" => "SECRET details" }
    error = assert_raises(GithubAppClient::Error) { @client.identity(code: "expired", code_verifier: "verifier") }
    assert_equal "That GitHub link expired. Connect again.", error.message
    assert_equal 1, @transport.calls.size
  end
  test "user token is revoked with App basic authentication after reading identity" do
    assert_equal({ id: "24680", login: "app-learner" }, @client.identity(code: "code", code_verifier: "verifier"))
    url, options = @transport.calls.last
    assert_equal "https://api.github.com/applications/client-id/token", url
    assert_equal({ username: "client-id", password: "synthetic-secret" }, options.fetch(:basic_auth))
    assert_equal({ "access_token" => "synthetic-oauth-token" }, JSON.parse(options.fetch(:body)))
    assert_equal 10, options.fetch(:timeout)
  end
  test "revocation failure never fails connection and failed user lookups still revoke" do
    @transport.revocation_failure = IOError.new("SECRET transport details")
    assert_equal({ id: "24680", login: "app-learner" }, @client.identity(code: "code", code_verifier: "verifier"))
    @transport.user_failure = IOError.new("SECRET user details")
    error = assert_raises(GithubAppClient::Error) { @client.identity(code: "code", code_verifier: "verifier") }
    assert_equal GithubAppClient::PROVIDER_ERROR, error.message
    assert_match(%r{/applications/client-id/token\z}, @transport.calls.last.first)
  end
  test "log filters redact only exact OAuth code and verifier while preserving code URLs" do
    filtered = ActiveSupport::ParameterFilter.new(Rails.application.config.filter_parameters).filter({ "code" => "SECRET", "code_verifier" => "SECRET", "github_code_url" => "https://github.com/learner/repo", "source_code" => "puts 1" })
    assert_equal "[FILTERED]", filtered.fetch("code")
    assert_equal "[FILTERED]", filtered.fetch("code_verifier")
    assert_equal "https://github.com/learner/repo", filtered.fetch("github_code_url")
    assert_equal "puts 1", filtered.fetch("source_code")
  end
  test "malformed token and identity bodies map to safe errors" do
    [ {}, [], { "access_token" => "SECRET" } ].each do |body|
      @transport.token_body = body
      error = assert_raises(GithubAppClient::Error) { @client.identity(code: "code", code_verifier: "verifier") }
      assert_equal GithubAppClient::PROVIDER_ERROR, error.message
      assert_not_includes error.message, "SECRET"
    end
    @transport.token_body = { "access_token" => "synthetic-token", "token_type" => "bearer" }
    [ {}, [], { "id" => 86420, "login" => "victim-gh", "type" => "Organization" } ].each do |body|
      @transport.person_body = body
      assert_raises(GithubAppClient::Error) { @client.identity(code: "code", code_verifier: "verifier") }
    end
  end
end
