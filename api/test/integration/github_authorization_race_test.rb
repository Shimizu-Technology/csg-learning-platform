require "test_helper"
require "timeout"
require_relative "../support/github_app_fixtures"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

class GithubAuthorizationRaceTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include NonTransactionalTestCleanup
  include LockWaitHelpers
  self.use_transactional_tests = false

  class Provider
    attr_reader :calls, :started, :release
    def initialize
      @calls, @started, @release = Queue.new, Queue.new, Queue.new
    end
    def authorization_url(state:, **)
      "https://github.com/login/oauth/authorize?#{URI.encode_www_form(state: state)}"
    end
    def identity(code:, **)
      @calls << code
      if code == "older" || code == "concurrent"
        @started << true
        @release.pop
      end
      code == "newer" ? { id: "86420", login: "newer-account" } : { id: "24680", login: "app-learner" }
    end
  end

  setup do
    @previous_features = SchoolSetting.current.features.deep_dup
    build_github_app_fixture
    @provider = Provider.new
    @threads = []
  end
  teardown do
    3.times { @provider.release << true }
    finish_test_threads(@threads)
    @cohort.destroy!
    @curriculum.destroy!
    delete_test_users(@admin, @instructor, @student, @other)
    SchoolSetting.current.update!(features: @previous_features)
  end

  def with_provider(&block)
    stub_app_method(GithubAppCredentials, :oauth_configured?, true) do
      stub_app_method(GithubAppCredentials, :client_id, "synthetic-client") do
        stub_app_method(GithubUserAuthorizationClient, :new, @provider, &block)
      end
    end
  end

  def headers_for_student = { "Authorization" => "Bearer test_token_#{@student.id}" }
  def prepare_state
    session = ActionDispatch::Integration::Session.new(Rails.application)
    session.post("/api/v1/enrollments/#{@enrollment.id}/github_identity/prepare", headers: headers_for_student)
    assert_equal 200, session.response.status
    URI.decode_www_form(URI(session.response.parsed_body.fetch("authorization_url")).query).to_h.fetch("state")
  end
  def callback(state, code)
    session = ActionDispatch::Integration::Session.new(Rails.application)
    session.post("/api/v1/github_identity/callback", headers: headers_for_student, params: { state: state, code: code }, as: :json)
    session.response.status
  end

  test "a provider completion loses to a newer completed authorization without changing its bindings" do
    with_provider do
      older = prepare_state
      @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { callback(older, "older") } }
      Timeout.timeout(10) { @provider.started.pop }
      newer = prepare_state
      assert_equal 200, callback(newer, "newer")
      @installation.update!(account_id: 86420, account_login: "newer-account")
      @fake.repository_owner = "newer-account"
      @fake.repository_owner_id = 86420
      @binding.reload.update!(full_name: "newer-account/prework-exercises")
      GithubRepositoryAccess.new(@binding, client: @fake).verify!
      identity = @student.reload.attributes.slice("github_user_id", "github_verified_login", "github_verified_at")
      binding = @binding.reload.attributes
      @provider.release << true
      assert_equal 404, Timeout.timeout(10) { @threads.sole.value }
      assert_equal identity, @student.reload.attributes.slice(*identity.keys)
      assert_equal binding, @binding.reload.attributes
    end
  end

  test "a newer preparation alone makes an in-flight completion stale" do
    with_provider do
      older = prepare_state
      @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { callback(older, "older") } }
      Timeout.timeout(10) { @provider.started.pop }
      prepare_state
      before = @binding.reload.attributes
      @provider.release << true
      assert_equal 404, Timeout.timeout(10) { @threads.sole.value }
      assert_equal before, @binding.reload.attributes
    end
  end

  test "two sessions on separate connections redeem one unused state exactly once" do
    with_provider do
      state = prepare_state
      connection_ids, results = Queue.new, Queue.new
      ActiveRecord::Base.transaction do
        @student.lock!
        holder = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        2.times do
          @threads << Thread.new do
            ActiveRecord::Base.connection_pool.with_connection do |connection|
              connection_ids << connection.select_value("SELECT pg_backend_pid()")
              result = callback(state, "concurrent")
              results << result
              result
            end
          end
        end
        wait_for_lock_waiters(holder, workers: @threads)
      end
      assert_equal 2, [ connection_ids.pop, connection_ids.pop ].uniq.size
      Timeout.timeout(10) { @provider.started.pop }
      assert_equal 404, Timeout.timeout(10) { results.pop }
      @provider.release << true
      assert_equal [ 200, 404 ], @threads.map { |thread| Timeout.timeout(10) { thread.value } }.sort
      assert_equal 1, @provider.calls.size
      assert_nil @student.reload.github_authorization_nonce_digest
    end
  end
end
