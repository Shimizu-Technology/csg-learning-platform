require "test_helper"
require_relative "../support/github_app_fixtures"
require_relative "../support/query_counter"

class GithubAppBindingsTest < ActionDispatch::IntegrationTest
  include GithubAppFixtures
  include QueryCounter
  setup { build_github_app_fixture }

  test "both explicit school and cohort activation are required including no school row" do
    SchoolSetting.delete_all
    [ nil, false, true ].each do |school|
      SchoolSetting.current.update!(features: school.nil? ? {} : { github_app: school })
      [ nil, false, true ].each do |cohort|
        @cohort.update!(settings: { features: cohort.nil? ? {} : { github_app: cohort } })
        assert_equal school == true && cohort == true, GithubRepositoryAccess.enabled?(@cohort)
        with_app_provider do
          as_app_user(@admin) { get installations_path, headers: app_headers }
          assert_response(school == true && cohort == true ? :success : :not_found)
        end
      end
    end
    assert_empty @fake.calls
  end

  test "admin connection and callback validate signed state actor cohort expiry and app" do
    with_app_provider do
      as_app_user(@admin) do
        get installations_path, headers: app_headers
        assert_response :success
        post "#{installations_path}/prepare", headers: app_headers
        assert_response :success
        state = response.parsed_body.fetch("state")
        assert_match "https://github.com/apps/synthetic-app/installations/new?state=", response.parsed_body.fetch("installation_url")
        post installations_path, headers: app_headers, params: { state: state, installation_id: 999 }, as: :json
        assert_response :success
        installation = response.parsed_body.fetch("installation")
        assert_equal "selected", installation.fetch("repository_selection")
        assert_equal "synthetic-school", installation.fetch("account_login")
        assert_equal 12345, installation.fetch("app_id")
        assert_no_secrets(response.body)
        post "/api/v1/github_app/setup", headers: app_headers, params: { state: state, installation_id: 999 }, as: :json
        assert_response :success
        post installations_path, headers: app_headers, params: { state: state + "tampered", installation_id: 999 }, as: :json
        assert_response :not_found
        travel 16.minutes do
          post installations_path, headers: app_headers, params: { state: state, installation_id: 999 }, as: :json
          assert_response :not_found
        end
        other = @cohort.dup
        other.name = "Other cohort"
        other.save!
        post installations_path(other), headers: app_headers, params: { state: state, installation_id: 999 }, as: :json
        assert_response :not_found
        another_admin = User.create!(clerk_id: "app-admin2", email: "app-admin2@example.invalid", role: :admin)
        as_app_user(another_admin) do
          post "/api/v1/github_app/setup", headers: app_headers, params: { state: state, installation_id: 999 }, as: :json
          assert_response :not_found
        end
        stub_app_method(GithubAppCredentials, :app_id, "different") do
          post installations_path, headers: app_headers, params: { state: state, installation_id: 999 }, as: :json
          assert_response :not_found
        end
      end
    end
  end

  test "instructors learners and missing cohorts receive the same setup 404" do
    with_app_provider do
      [ @instructor, @student, @other ].each do |user|
        as_app_user(user) do
          [ installations_path, "#{installations_path}/prepare", "/api/v1/cohorts/0/github_app_installations" ].each do |path|
            path.end_with?("prepare") ? post(path, headers: app_headers) : get(path, headers: app_headers)
            assert_response :not_found
            assert_equal({ "error" => "Not found" }, response.parsed_body)
          end
          post "/api/v1/github_app/setup", headers: app_headers, params: { state: "bad", installation_id: 999 }, as: :json
          assert_response :not_found
        end
      end
    end
    assert_empty @fake.calls
  end

  test "learner and admin save pending verify numeric repository and recover from failure" do
    with_app_provider do
      [ @student, @admin ].each do |user|
        as_app_user(user) do
          get bindings_path, headers: app_headers
          assert_response :success
          [ "wrong-owner/prework-exercises", "app-learner/unselected", "app-learner/prework-exercises" ].each do |name|
            post bindings_path, headers: app_headers, params: { github_app_installation_id: @installation.id, full_name: name }, as: :json
            assert_response :success
            assert_equal "pending", response.parsed_body.dig("binding", "verification_state")
            post "#{bindings_path}/#{@binding.id}/verify", headers: app_headers
            assert_response :success
            binding = response.parsed_body.fetch("binding")
            expected = name == "app-learner/prework-exercises" ? "verified" : "failed"
            assert_equal expected, binding.fetch("verification_state")
            if expected == "verified"
              assert_equal 98765, binding.fetch("repository_id")
              assert binding.fetch("verified_at")
              assert_nil binding.fetch("failure_reason")
            else
              assert binding.fetch("failure_reason").present?
              assert_nil binding.fetch("verified_at")
            end
          end
        end
      end
    end
  end

  test "scope refuses other enrollment installation module instructor paused and inactive identities" do
    another = Cohort.create!(name: "App other cohort", curriculum: Curriculum.create!(name: "Other curriculum"), start_date: Date.current)
    other_mod = another.curriculum.modules.create!(name: "Other module", position: 0)
    bad_installation = @installation.dup
    bad_installation.cohort = another
    bad_installation.save!
    [ @instructor, @other ].each do |user|
      as_app_user(user) do
        get bindings_path, headers: app_headers
        assert_response :not_found
        post "#{bindings_path}/#{@binding.id}/verify", headers: app_headers
        assert_response :not_found
      end
    end
    as_app_user(@student) do
      post bindings_path, headers: app_headers, params: { github_app_installation_id: bad_installation.id, full_name: @binding.full_name }, as: :json
      assert_response :not_found
      post bindings_path, headers: app_headers, params: { github_app_installation_id: @installation.id, full_name: @binding.full_name, curriculum_module_id: other_mod.id }, as: :json
      assert_response :not_found
      @enrollment.update!(status: :paused)
      get bindings_path, headers: app_headers
      assert_response :not_found
    end
    @enrollment.update!(status: :active)
    @student.update!(archived_at: Time.current)
    as_app_user(@admin) { get bindings_path, headers: app_headers }
    assert_response :not_found
    assert_empty @fake.calls
  end

  test "module binding does not replace default and cross enrollment binding ids refuse" do
    with_app_provider do
      as_app_user(@student) do
        post bindings_path, headers: app_headers, params: { github_app_installation_id: @installation.id, full_name: "app-learner/module-repo", curriculum_module_id: @mod.id }, as: :json
        assert_response :success
        assert_equal 2, @enrollment.github_repository_bindings.count
        assert_equal "app-learner/prework-exercises", @binding.reload.full_name
        post "#{bindings_path}/0/verify", headers: app_headers
        assert_response :not_found
      end
    end
  end

  test "binding list queries stay flat as module bindings grow and username changes show reconnect" do
    GithubRepositoryAccess.new(@binding, client: @fake).verify!
    as_app_user(@student) { get bindings_path, headers: app_headers } # Warm authentication bootstrap.
    queries = count_queries { as_app_user(@student) { get bindings_path, headers: app_headers } }
    5.times do |index|
      mod = @curriculum.modules.create!(name: "App extra #{index}", position: index + 1)
      @enrollment.github_repository_bindings.create!(github_app_installation: @installation, curriculum_module: mod, full_name: @binding.full_name)
    end
    assert_equal queries, count_queries { as_app_user(@student) { get bindings_path, headers: app_headers } }
    @student.update!(github_username: "new-identity")
    as_app_user(@student) { get bindings_path, headers: app_headers }
    assert_response :success
    assert_equal "failed", response.parsed_body.fetch("bindings").first.fetch("verification_state")
    assert_match "username changed", response.parsed_body.fetch("bindings").first.fetch("failure_reason")
  end

  test "learner profile has optional App flag only on opted in enrollments" do
    as_app_user(@student) { get "/api/v1/profile", headers: app_headers }
    assert_response :success
    assert_equal true, response.parsed_body.fetch("enrollments").first.fetch("github_app_enabled")
    @cohort.update!(settings: {})
    as_app_user(@student) { get "/api/v1/profile", headers: app_headers }
    assert_response :success
    assert_not response.parsed_body.fetch("enrollments").first.key?("github_app_enabled")
  end

  private

  def assert_no_secrets(body)
    %w[private_key webhook_secret access_token Authorization BEGIN].each { |text| assert_not_includes body, text }
  end
end
