require "test_helper"

class GithubAppClientTest < ActiveSupport::TestCase
  Response = Struct.new(:code, :parsed_response) do
    def success? = code.between?(200, 299)
  end
  Credentials = Struct.new(:app_id, :slug, :private_key) do
    def configured? = true
  end
  Installation = Struct.new(:installation_id)

  class Transport
    attr_reader :calls
    attr_accessor :unauthorized, :revoked, :unselected, :token_expiry, :suspended, :wrong_app
    def initialize
      @calls = []
      @tokens = 0
    end

    def get(url, **options) = request(:get, url, options)
    def post(url, **options) = request(:post, url, options)

    def request(method, url, options)
      @calls << [ method, url, options ]
      if url.end_with?("/access_tokens")
        @tokens += 1
        body = JSON.parse(options.fetch(:body))
        return Response.new(422, { "message" => "SECRET provider details" }) if unselected && body["repository_ids"]

        return Response.new(201, { "token" => "synthetic-token-#{@tokens}", "expires_at" => (token_expiry || 1.hour.from_now).iso8601 })
      end
      if url.end_with?("/app/installations/123")
        return Response.new(200, { "app_id" => wrong_app ? 99 : 12345, "suspended_at" => suspended ? Time.current.iso8601 : nil })
      end
      return Response.new(403, { "message" => "SECRET provider details" }) if revoked
      if unauthorized
        self.unauthorized = false
        return Response.new(401, { "message" => "SECRET provider details" })
      end
      if url.end_with?("/check-runs")
        return Response.new(200, { "total_count" => 0, "check_runs" => [] })
      end
      Response.new(200, { "id" => 98765, "full_name" => "app-learner/prework-exercises", "owner" => { "login" => "app-learner", "type" => "User" } })
    end
  end

  setup do
    @key = OpenSSL::PKey::RSA.generate(2048)
    @transport = Transport.new
    @client = GithubAppClient.new(transport: @transport, credentials: Credentials.new("12345", "synthetic-app", @key.to_pem), cache: ActiveSupport::Cache::MemoryStore.new)
    @installation = Installation.new(123)
  end

  test "JWT is RS256 scoped in time and tokens are short cached per installation and repo" do
    @client.installation(123)
    jwt = @transport.calls.last[2].fetch(:headers).fetch("Authorization").delete_prefix("Bearer ")
    claims, header = JWT.decode(jwt, @key.public_key, true, algorithm: "RS256")
    assert_equal "RS256", header.fetch("alg")
    assert_equal "12345", claims.fetch("iss")
    assert_in_delta Time.current.to_i - 60, claims.fetch("iat"), 2
    assert_operator claims.fetch("exp"), :<=, 10.minutes.from_now.to_i
    2.times { @client.repository(installation: @installation, full_name: "app-learner/prework-exercises") }
    tokens = token_calls
    assert_equal 2, tokens.size # installation-wide discovery, then numeric restriction
    assert_equal [ 98765 ], JSON.parse(tokens.last[2].fetch(:body)).fetch("repository_ids")
    assert_equal 5, @transport.calls.count { |call| call[0] == :get || call[1].end_with?("/access_tokens") }
    travel 6.minutes do
      @client.repository(installation: @installation, full_name: "app-learner/prework-exercises", repository_id: 98765)
      assert_equal 3, token_calls.size
    end
  end

  test "expired token retries exactly once and does not leak provider bodies" do
    @client.repository(installation: @installation, full_name: "app-learner/prework-exercises", repository_id: 98765)
    @transport.unauthorized = true
    @client.checks(installation: @installation, repository_id: 98765, full_name: "app-learner/prework-exercises", sha: "a" * 40, page: 1)
    assert_equal 2, token_calls.size
    @transport.revoked = true
    error = assert_raises(GithubAppClient::Error) { @client.repository(installation: @installation, full_name: "app-learner/prework-exercises", repository_id: 98765) }
    assert_equal 403, error.status
    assert_not_includes error.message, "SECRET"
  end

  test "public but unselected repository cannot be verified and wrong app or suspended installation refuses" do
    @transport.unselected = true
    error = assert_raises(GithubAppClient::Error) { @client.repository(installation: @installation, full_name: "app-learner/prework-exercises") }
    assert_equal 422, error.status
    @transport.wrong_app = true
    assert_raises(GithubAppClient::Error) { @client.installation(123) }
    @transport.wrong_app = false
    @transport.suspended = true
    assert_raises(GithubAppClient::Error) { @client.installation(123) }
  end

  test "nearly expired response token is not cached or used" do
    @transport.token_expiry = 20.seconds.from_now
    assert_raises(GithubAppClient::Error) { @client.repository(installation: @installation, full_name: "app-learner/prework-exercises") }
    assert_equal 1, token_calls.size
    assert_equal 1, @transport.calls.size
  end

  private

  def token_calls = @transport.calls.select { |call| call[1].end_with?("/access_tokens") }
end
