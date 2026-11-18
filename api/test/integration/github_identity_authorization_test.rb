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
