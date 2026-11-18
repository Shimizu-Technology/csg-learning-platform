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
    attr_accessor :token_body, :person_body
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
      Response.new(person_body)
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
    assert_equal "Bearer synthetic-oauth-token", @transport.calls.last.last.fetch(:headers).fetch("Authorization")
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
