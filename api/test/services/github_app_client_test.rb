require "test_helper"

class GithubAppClientTest < ActiveSupport::TestCase
  Response = Struct.new(:code, :parsed_response, :headers) do
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
    def patch(url, **options) = request(:patch, url, options)

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
      if url.end_with?("/issues") && method == :get
        return Response.new(200, [
          { "number" => 5, "html_url" => "https://github.com/app-learner/prework-exercises/pull/5", "state" => "open", "body" => "<!-- csg-delivery:tok -->", "pull_request" => {} },
          { "number" => 7, "html_url" => "https://github.com/app-learner/prework-exercises/issues/7", "state" => "open", "body" => "Feedback\n<!-- csg-delivery:tok -->" }
        ])
      end
      if url.end_with?("/issues") && method == :post
        return Response.new(201, { "number" => 7, "html_url" => "https://github.com/app-learner/prework-exercises/issues/7", "state" => "open" })
      end
      if url.end_with?("/issues/7/comments") && method == :get
        return Response.new(200, [ { "id" => 91, "body" => "Follow up\n<!-- csg-delivery:comment-tok -->" } ])
      end
      if url.end_with?("/issues/7/comments") && method == :post
        return Response.new(201, { "id" => 92, "html_url" => "https://github.com/app-learner/prework-exercises/issues/7#issuecomment-92" })
      end
      if url.end_with?("/issues/7") && method == :get
        return Response.new(200, { "number" => 7, "html_url" => "https://github.com/app-learner/prework-exercises/issues/7", "state" => "closed", "title" => "Redo: Ex 1", "body" => "Original" })
      end
      if url.end_with?("/issues/7") && method == :patch
        parsed = JSON.parse(options.fetch(:body))
        return Response.new(200, { "number" => 7, "html_url" => "https://github.com/app-learner/prework-exercises/issues/7", "state" => parsed.fetch("state") })
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

  test "source fetch captures workflow_paths blob OID and SHA-256 at the exact submitted SHA" do
    repository = { "id" => 98765, "full_name" => "app-learner/prework-exercises" }
    workflow_text = "name: Prework Checks\n"
    workflow_oid = "d" * 40
    captured_queries = []
    original_request = @transport.method(:request)
    @transport.define_singleton_method(:request) do |method, url, options|
      if url.end_with?("/graphql")
        captured_queries << JSON.parse(options.fetch(:body)).fetch("query")
        return Response.new(200, { "data" => { "repository" => {
          "fullDatabaseId" => "98765",
          "defaultBranchRef" => { "name" => "main", "target" => { "oid" => "c" * 40 } },
          "file_0" => { "text" => "puts 'source'", "byteSize" => "puts 'source'".bytesize, "isTruncated" => false },
          "workflow_0" => { "oid" => workflow_oid, "text" => workflow_text, "byteSize" => workflow_text.bytesize, "isTruncated" => false },
          "workflow_1" => nil
        } } })
      end
      original_request.call(method, url, options)
    end

    result = @client.files(
      installation: @installation,
      repository: repository,
      filenames: [ "111.rb" ],
      workflow_paths: [ ".github/workflows/prework-checks.yml", ".github/workflows/missing.yml" ]
    )
    query = captured_queries.last
    assert_includes query, "#{'c' * 40}:.github/workflows/prework-checks.yml"
    assert_equal(
      {
        ".github/workflows/prework-checks.yml" => {
          "present" => true,
          "oid" => workflow_oid,
          "sha256" => Digest::SHA256.hexdigest(workflow_text)
        },
        ".github/workflows/missing.yml" => { "present" => false }
      },
      result[:workflow_files]
    )
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

  test "issue lifecycle methods scope installation tokens to numeric repository_id and ignore PRs in marker search" do
    repo_args = { installation: @installation, repository_id: 98765, full_name: "app-learner/prework-exercises" }

    created = @client.create_issue(**repo_args, title: "Redo: Ex 1", body: "Fix it")
    assert_equal({ "number" => 7, "html_url" => "https://github.com/app-learner/prework-exercises/issues/7", "state" => "open" }, created)

    found = @client.find_issue_by_marker(**repo_args, marker: "<!-- csg-delivery:tok -->")
    assert_equal 7, found.fetch("number")

    found_comment = @client.find_issue_by_marker(**repo_args, marker: "<!-- csg-delivery:comment-tok -->", issue_number: 7)
    assert_equal true, found_comment.fetch("matched_comment")

    fetched = @client.get_issue(**repo_args, issue_number: 7)
    assert_equal "closed", fetched.fetch("state")

    reopened = @client.reopen_issue(**repo_args, issue_number: 7)
    assert_equal "open", reopened.fetch("state")

    comment = @client.add_issue_comment(**repo_args, issue_number: 7, body: "Please revise")
    assert_equal 92, comment.fetch("id")

    closed = @client.close_issue(**repo_args, issue_number: 7, comment: "Graded **B**")
    assert_equal "closed", closed.fetch("state")

    assert_equal [ [ 98765 ] ], token_calls.map { |call| JSON.parse(call[2].fetch(:body)).fetch("repository_ids") }
  end

  test "find_issue_by_marker paginates through issues and comments and raises InconclusiveSearchError at page cap" do
    repo_args = { installation: @installation, repository_id: 98765, full_name: "app-learner/prework-exercises" }

    # Marker on page 2 of issues
    page_transport = Transport.new
    original_request = page_transport.method(:request)
    page_transport.define_singleton_method(:request) do |method, url, options|
      if url.end_with?("/issues") && method == :get
        page = options.dig(:query, :page).to_i
        if page == 1
          return Response.new(200, Array.new(100) { |i| { "number" => i + 1, "html_url" => "https://github.com/app-learner/prework-exercises/issues/#{i + 1}", "state" => "open", "body" => "other" } },
            { "Link" => '<https://api.github.com/repos/app-learner/prework-exercises/issues?page=2>; rel="next"' })
        elsif page == 2
          return Response.new(200, [ { "number" => 101, "html_url" => "https://github.com/app-learner/prework-exercises/issues/101", "state" => "open", "body" => "<!-- csg-delivery:page2 -->" } ], {})
        end
      end
      original_request.call(method, url, options)
    end
    client = GithubAppClient.new(transport: page_transport, credentials: Credentials.new("12345", "synthetic-app", @key.to_pem), cache: ActiveSupport::Cache::MemoryStore.new)

    found = client.find_issue_by_marker(**repo_args, marker: "<!-- csg-delivery:page2 -->")
    assert_equal 101, found.fetch("number")

    # Marker not found after bounded page limit raises InconclusiveSearchError
    cap_transport = Transport.new
    cap_original = cap_transport.method(:request)
    cap_transport.define_singleton_method(:request) do |method, url, options|
      if url.end_with?("/issues") && method == :get
        page = options.dig(:query, :page).to_i
        return Response.new(200, Array.new(100) { |i| { "number" => (page - 1) * 100 + i + 1, "html_url" => "https://github.com/app-learner/prework-exercises/issues/1", "state" => "open", "body" => "none" } },
          { "Link" => %(<https://api.github.com/repos/app-learner/prework-exercises/issues?page=#{page + 1}>; rel="next") })
      end
      if url.end_with?("/issues/7/comments") && method == :get
        page = options.dig(:query, :page).to_i
        return Response.new(200, Array.new(100) { |i| { "id" => page * 100 + i, "body" => "no match" } },
          { "Link" => %(<https://api.github.com/repos/app-learner/prework-exercises/issues/7/comments?page=#{page + 1}>; rel="next") })
      end
      cap_original.call(method, url, options)
    end
    cap_client = GithubAppClient.new(transport: cap_transport, credentials: Credentials.new("12345", "synthetic-app", @key.to_pem), cache: ActiveSupport::Cache::MemoryStore.new)

    error = assert_raises(GithubAppClient::InconclusiveSearchError) do
      cap_client.find_issue_by_marker(**repo_args, marker: "<!-- csg-delivery:missing -->", max_pages: 2)
    end
    assert_includes error.message, "2 pages"

    comment_error = assert_raises(GithubAppClient::InconclusiveSearchError) do
      cap_client.find_issue_by_marker(**repo_args, marker: "<!-- csg-delivery:missing -->", issue_number: 7, max_pages: 2)
    end
    assert_includes comment_error.message, "2 pages"
  end

  test "403 rate limit responses are classified as rate_limited and transient with Retry-After without leaking body" do
    rate_transport = Transport.new
    original_request = rate_transport.method(:request)
    rate_transport.define_singleton_method(:request) do |method, url, options|
      return original_request.call(method, url, options) if url.end_with?("/access_tokens")

      Response.new(403, { "message" => "SECRET API rate limit exceeded" }, { "X-RateLimit-Remaining" => "0", "Retry-After" => "120" })
    end
    client = GithubAppClient.new(transport: rate_transport, credentials: Credentials.new("12345", "synthetic-app", @key.to_pem), cache: ActiveSupport::Cache::MemoryStore.new)

    error = assert_raises(GithubAppClient::Error) do
      client.create_issue(installation: @installation, repository_id: 98765, full_name: "app-learner/prework-exercises", title: "Redo", body: "Fix")
    end
    assert_equal 403, error.status
    assert error.rate_limited?
    assert error.transient?
    assert_equal 120, error.retry_after
    assert_not_includes error.message, "SECRET"
    assert_includes error.message, "rate limit"
  end

  test "find_issue_by_markers scans multiple markers in one paginated pass and enforces deadline budget" do
    repo_args = { installation: @installation, repository_id: 98765, full_name: "app-learner/prework-exercises" }
    page_calls = []
    timeouts = []

    multi_transport = Transport.new
    original_request = multi_transport.method(:request)
    multi_transport.define_singleton_method(:request) do |method, url, options|
      if url.end_with?("/issues") && method == :get
        page = options.dig(:query, :page).to_i
        page_calls << page
        timeouts << options[:timeout]
        if page == 1
          return Response.new(200, Array.new(100) { |i| { "number" => i + 1, "html_url" => "https://github.com/app-learner/prework-exercises/issues/#{i + 1}", "state" => "open", "body" => "other" } },
            { "Link" => '<https://api.github.com/repos/app-learner/prework-exercises/issues?page=2>; rel="next"' })
        elsif page == 2
          return Response.new(200, [ { "number" => 102, "html_url" => "https://github.com/app-learner/prework-exercises/issues/102", "state" => "open", "body" => "<!-- csg-delivery:m3 -->" } ], {})
        end
      end
      original_request.call(method, url, options)
    end
    client = GithubAppClient.new(transport: multi_transport, credentials: Credentials.new("12345", "synthetic-app", @key.to_pem), cache: ActiveSupport::Cache::MemoryStore.new)

    # All 3 markers scanned in one pass (2 pages total, not 3x2)
    clock_ticks = [ 10.0, 16.0 ]
    found = client.find_issue_by_markers(
      **repo_args,
      markers: [ "<!-- csg-delivery:m1 -->", "<!-- csg-delivery:m2 -->", "<!-- csg-delivery:m3 -->" ],
      deadline: 20.0,
      monotonic: -> { clock_ticks.shift || 16.0 }
    )
    assert_equal 102, found.fetch("number")
    assert_equal "<!-- csg-delivery:m3 -->", found.fetch("matched_marker")
    assert_equal [ 1, 2 ], page_calls
    assert_equal [ 10.0, 4.0 ], timeouts

    # Deadline expiring between pages raises BudgetExceeded without fetching page 2
    page_calls.clear
    expired_ticks = [ 15.0, 21.0 ]
    assert_raises(GithubAppClient::BudgetExceeded) do
      client.find_issue_by_markers(
        **repo_args,
        markers: [ "<!-- csg-delivery:m3 -->" ],
        deadline: 20.0,
        monotonic: -> { expired_ticks.shift || 21.0 }
      )
    end
    assert_equal [ 1 ], page_calls
  end

  private

  def token_calls = @transport.calls.select { |call| call[1].end_with?("/access_tokens") }
end
