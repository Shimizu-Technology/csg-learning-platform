require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/fake_github_user_authorization_client"

class GithubIdentityAuthorizationTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  setup do
    build_github_app_fixture
    @student.update_columns(github_user_id: nil, github_verified_login: nil, github_verified_at: nil)
    @oauth = FakeGithubUserAuthorizationClient.new
  end

  def with_oauth(&block)
    stub_app_method(GithubAppCredentials, :oauth_configured?, true) do
      stub_app_method(GithubAppCredentials, :client_id, "synthetic-client") do
        stub_app_method(GithubUserAuthorizationClient, :new, @oauth, &block)
      end
    end
  end

  def prepare_identity
    post "/api/v1/enrollments/#{@enrollment.id}/github_identity/prepare", headers: app_headers
    assert_response :success
    URI.decode_www_form(URI(response.parsed_body.fetch("authorization_url")).query).to_h.fetch("state")
  end

  def connect(state)
    post "/api/v1/github_identity/callback", headers: app_headers, params: { state: state, code: "synthetic-code" }, as: :json
  end

  test "signed one-use user-bound state proves identity and locks profile username" do
    with_oauth do
      as_app_user(@student) do
        state = prepare_identity
        assert_match(/\A[A-Za-z0-9_-]{43}\z/, @oauth.calls.sole.last)
        assert_not_includes state, "code_verifier"
        as_app_user(@other) { connect(state); assert_response :not_found }
        connect(state)
        assert_response :success
        assert_equal "24680", response.parsed_body.dig("github_identity", "id")
        assert @student.reload.github_verified_at
        assert_equal "app-learner", @student.github_verified_login
        assert_nil @student.github_authorization_nonce_digest
        refute_match(/access_token|refresh_token|client_secret|code_verifier/, response.body)
        connect(state)
        assert_response :not_found
        assert_equal 1, @oauth.calls.count { |row| row.first == :identity }
        patch "/api/v1/profile", headers: app_headers, params: { github_username: "victim-gh" }, as: :json
        assert_response :unprocessable_entity
        assert_equal "app-learner", @student.reload.github_username
      end
    end
  end

  test "expired tampered superseded state and disabled cohort refuse without provider I O" do
    with_oauth do
      as_app_user(@student) do
        [ nil, { forged: "state" }, [ "state" ] ].each { |state| connect(state); assert_response :not_found }
        first = prepare_identity
        current = prepare_identity
        [ first, current + "tampered" ].each { |state| connect(state); assert_response :not_found }
        travel 11.minutes do
          connect(current)
          assert_response :not_found
        end
        @cohort.update!(settings: {})
        connect(current)
        assert_response :not_found
        post "/api/v1/enrollments/#{@enrollment.id}/github_identity/prepare", headers: app_headers
        assert_response :not_found
        assert_not @oauth.calls.any? { |row| row.first == :identity }
      end
    end
  end

  test "a GitHub user id cannot connect to two Learn users even with duplicate legacy logins" do
    @other.record_verified_github_identity!(id: "24680", login: "old-login")
    @student.update!(github_username: "old-login")
    with_oauth do
      as_app_user(@student) do
        connect(prepare_identity)
        assert_response :conflict
        assert_nil @student.reload.github_user_id
        assert_equal "24680", @other.reload.github_user_id
      end
    end
  end

  test "admin update and re-add skip a verified username with warning and preserve bindings" do
    @student.record_verified_github_identity!(id: "24680", login: "app-learner")
    GithubRepositoryAccess.new(@binding.reload, client: @fake).verify!
    before_identity = @student.reload.attributes.slice("github_user_id", "github_verified_login", "github_verified_at", "github_username")
    as_app_user(@admin) do
      patch "/api/v1/users/#{@student.id}", headers: app_headers, params: { github_username: "victim-gh", first_name: "Updated" }, as: :json
      assert_response :success
      assert_match "skipped this change", response.parsed_body.fetch("warnings").sole
      assert_equal "Updated", @student.reload.first_name
      assert_equal before_identity, @student.attributes.slice(*before_identity.keys)
      post "/api/v1/users", headers: app_headers, params: { email: @student.email, github_username: "victim-gh", skip_invite: true }, as: :json
      assert_response :created
      assert_match "skipped this change", response.parsed_body.fetch("warnings").sole
      assert_equal before_identity, @student.reload.attributes.slice(*before_identity.keys)
    end
    assert_equal "verified", @binding.reload.verification_state
    assert @binding.verified_at
  end

  test "case-only verified username edits are no-ops for self admin and re-add" do
    @student.record_verified_github_identity!(id: "24680", login: "app-learner")
    as_app_user(@student) do
      patch "/api/v1/profile", headers: app_headers, params: { github_username: "APP-Learner" }, as: :json
      assert_response :success
    end
    as_app_user(@admin) do
      patch "/api/v1/users/#{@student.id}", headers: app_headers, params: { github_username: "APP-Learner" }, as: :json
      assert_response :success
      assert_not response.parsed_body.key?("warnings")
      post "/api/v1/users", headers: app_headers, params: { email: @student.email, github_username: "APP-Learner", skip_invite: true }, as: :json
      assert_response :created
      assert_not response.parsed_body.key?("warnings")
    end
    assert_equal "app-learner", @student.reload.github_username
    assert_equal "24680", @student.github_user_id
  end

  test "expired provider code consumes nonce with explicit reconnect recovery" do
    with_oauth do
      as_app_user(@student) do
        state = prepare_identity
        @oauth.failure = GithubAppClient::Error.new("That GitHub link expired. Connect again.")
        connect(state)
        assert_response :unprocessable_entity
        assert_equal "That GitHub link expired. Connect again.", response.parsed_body.fetch("error")
        assert_nil @student.reload.github_authorization_nonce_digest
        connect(state)
        assert_response :not_found
        @oauth.failure = nil
        connect(prepare_identity)
        assert_response :success
      end
    end
  end

  test "profile username write rechecks proof committed after authentication loaded the user" do
    student_id = @student.id
    callback = proc do |controller|
      if controller.action_name == "update" && controller.send(:current_user).id == student_id
        User.find(student_id).record_verified_github_identity!(id: "24680", login: "just-proven")
      end
    end
    Api::V1::ProfileController.before_action(callback)
    as_app_user(@student) do
      patch "/api/v1/profile", headers: app_headers, params: { github_username: "victim-login" }, as: :json
      assert_response :unprocessable_entity
    end
    assert_equal "just-proven", @student.reload.github_username
    assert_equal "24680", @student.github_user_id
  ensure
    Api::V1::ProfileController.skip_before_action(callback) if callback
  end

  test "legacy Off profile stays editable and duplicate unverified usernames remain allowed" do
    @cohort.update!(settings: {})
    @other.update!(github_username: "victim-gh")
    as_app_user(@student) do
      patch "/api/v1/profile", headers: app_headers, params: { github_username: "victim-gh" }, as: :json
      assert_response :success
      assert_not response.parsed_body.fetch("user").key?("github_identity")
      assert_equal "victim-gh", @student.reload.github_username
    end
  end
end
