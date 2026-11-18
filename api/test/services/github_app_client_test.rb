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
    attr_accessor :unauthorized, :revoked, :unselected, :token_expiry, :suspended, :wrong_app, :graphql_repository_id, :source_truncated, :source_byte_size
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
        return Response.new(200, { "id" => 123, "account" => { "id" => 24680, "login" => "app-learner", "type" => "User" }, "repository_selection" => "selected", "permissions" => {}, "app_id" => wrong_app ? 99 : 12345, "suspended_at" => suspended ? Time.current.iso8601 : nil })
      end
      return Response.new(403, { "message" => "SECRET provider details" }) if revoked
      if unauthorized
        self.unauthorized = false
        return Response.new(401, { "message" => "SECRET provider details" })
      end
      if url.end_with?("/graphql")
        return Response.new(200, { "data" => { "repository" => { "fullDatabaseId" => (graphql_repository_id || 98765).to_s,
          "defaultBranchRef" => { "name" => "main", "target" => { "oid" => "c" * 40 } },
          "file_0" => { "text" => "puts 'source'", "byteSize" => source_byte_size || "puts 'source'".bytesize, "isTruncated" => source_truncated || false } } } })
      end
      if url.end_with?("/check-runs")
        return Response.new(200, { "total_count" => 0, "check_runs" => [] })
      end
      Response.new(200, { "id" => 98765, "full_name" => "app-learner/prework-exercises", "fork" => false, "owner" => { "id" => 24680, "login" => "app-learner", "type" => "User" } })
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

  test "source fetch compares BigInt repository provenance and refuses a replacement repository" do
    @transport.graphql_repository_id = 4_000_000_000
    repository = { "id" => 4_000_000_000, "full_name" => "app-learner/prework-exercises" }
    result = @client.files(installation: @installation, repository: repository, filenames: [ "nested/111.rb" ])
    assert_equal [ { "name" => "nested/111.rb", "text" => "puts 'source'" } ], result[:files]
    assert_equal "c" * 40, result[:commit_hash]
    assert_equal "main", result[:branch]
    assert_nil result[:error]
    query = JSON.parse(@transport.calls.last[2].fetch(:body)).fetch("query")
    assert_includes query, "fullDatabaseId"
    assert_includes query, "followRenames: false"
    assert_includes query, "#{'c' * 40}:nested/111.rb"
    refute_includes query, "HEAD:"
    assert_equal 2, @transport.calls.count { |call| call[1].end_with?("/graphql") }
    assert_equal [ 4_000_000_000 ], JSON.parse(token_calls.sole[2].fetch(:body)).fetch("repository_ids")
    @transport.graphql_repository_id += 1
    assert_raises(GithubAppClient::Error) { @client.files(installation: @installation, repository: repository, filenames: [ "nested/111.rb" ]) }
  end

  test "nearly expired response token is not cached or used" do
    @transport.token_expiry = 20.seconds.from_now
    assert_raises(GithubAppClient::Error) { @client.repository(installation: @installation, full_name: "app-learner/prework-exercises") }
    assert_equal 1, token_calls.size
    assert_equal 1, @transport.calls.size
  end

  test "truncated or incomplete text cannot be presented as immutable full source" do
    repository = { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
    @transport.source_truncated = true
    error = assert_raises(GithubAppClient::Error) { @client.files(installation: @installation, repository: repository, filenames: [ "111.rb" ]) }
    assert_match "truncated source", error.message
    @transport.source_truncated = false
    @transport.source_byte_size = 100
    error = assert_raises(GithubAppClient::Error) { @client.files(installation: @installation, repository: repository, filenames: [ "111.rb" ]) }
    assert_match "complete UTF-8 source", error.message
  end

  test "unexpected provider bodies become generic errors at every public boundary" do
    [ {}, [], { "token" => "SECRET" } ].each do |body|
      [ :installation, :repository, :files, :checks ].each do |operation|
        transport = Transport.new
        original = transport.method(:request)
        transport.define_singleton_method(:request) do |method, url, options|
          url.end_with?("/access_tokens") ? original.call(method, url, options) : Response.new(200, body)
        end
        client = GithubAppClient.new(transport: transport, credentials: Credentials.new("12345", "app", @key.to_pem), cache: ActiveSupport::Cache::MemoryStore.new)
        error = assert_raises(GithubAppClient::Error) do
          case operation
          when :installation then client.installation(123)
          when :repository then client.repository(installation: @installation, full_name: "app-learner/prework-exercises")
          when :files then client.files(installation: @installation, repository: { "id" => 98765, "full_name" => "app-learner/prework-exercises" }, filenames: [ "111.rb" ])
          when :checks then client.checks(installation: @installation, repository_id: 98765, full_name: "app-learner/prework-exercises", sha: "a" * 40, page: 1)
          end
        end
        assert_equal GithubAppClient::PROVIDER_ERROR, error.message
      end
    end
    @transport.define_singleton_method(:post) { |*args, **kwargs| Response.new(201, {}) }
    error = assert_raises(GithubAppClient::Error) { @client.repository(installation: @installation, full_name: "app-learner/prework-exercises") }
    assert_equal GithubAppClient::PROVIDER_ERROR, error.message
  end

  private

  def token_calls = @transport.calls.select { |call| call[1].end_with?("/access_tokens") }
end
