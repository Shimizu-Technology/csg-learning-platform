require "test_helper"

class FeatureSwitchesTest < ActionDispatch::IntegrationTest
  setup do
    @admin = User.create!(clerk_id: "switch_admin", email: "switch-admin@example.com", role: :admin)
    @student = User.create!(clerk_id: "switch_student", email: "switch-student@example.com", role: :student)
    @cohort = Cohort.create!(name: "Switch course", curriculum: Curriculum.create!(name: "Switch curriculum"), start_date: Date.current, status: :active)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
  end

  test "all switches default on and explicit cohort values override school with nil inheriting" do
    assert_equal FeatureSwitches::KEYS.index_with(true), FeatureSwitches.for(cohort: @cohort)
    SchoolSetting.current.update!(features: { recordings: false, office_hours: false })
    @cohort.update!(settings: { features: { recordings: true, office_hours: nil, help_requests: false } })
    resolved = FeatureSwitches.for(cohort: @cohort)
    assert resolved["recordings"]
    assert_not resolved["office_hours"]
    assert_not resolved["help_requests"]
    assert resolved["announcements"]
  end

  test "admin settings preserve unrelated cohort configuration and audit actor and values" do
    @cohort.update!(settings: { "class_resources" => [], "recordings" => [] })
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/feature_settings", headers: @headers, params: { features: { recordings: false, office_hours: nil } }, as: :json
    end
    assert_response :success
    assert_equal false, response.parsed_body.dig("features", "recordings")
    assert_equal [], @cohort.reload.settings["recordings"]
    assert_equal({ "recordings" => false }, @cohort.settings["features"])
    audit = FeatureSwitchChange.last
    assert_equal @admin, audit.actor
    assert_equal @cohort, audit.cohort
    assert_equal true, audit.before.dig("features", "recordings")
    assert_equal false, audit.after.dig("features", "recordings")
  end

  test "learners cannot change defaults and unknown switches are rejected" do
    as_user(@student) { patch "/api/v1/feature_settings", headers: @headers, params: { features: { recordings: false } }, as: :json }
    assert_response :forbidden
    as_user(@admin) { patch "/api/v1/feature_settings", headers: @headers, params: { features: { unknown: false } }, as: :json }
    assert_response :unprocessable_entity
    assert_empty FeatureSwitchChange.all
  end

  test "public catalog mode is available without authentication" do
    %w[automatic always hidden].each do |mode|
      SchoolSetting.current.update!(public_catalog_mode: mode)
      get "/api/v1/course_offerings"
      assert_response :success
      assert_equal mode, response.parsed_body["public_catalog_mode"]
    end
  end

  test "disabled office hours recordings help and meeting booking reject learner calls" do
    SchoolSetting.current.update!(features: FeatureSwitches::KEYS.index_with(false))
    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/office_hours", headers: @headers
      assert_response :forbidden
      get "/api/v1/cohorts/#{@cohort.id}/recordings", headers: @headers
      assert_response :forbidden
      post "/api/v1/help_requests", headers: @headers, params: { help_request: { cohort_id: @cohort.id, context_type: "lesson", context_id: 1 } }, as: :json
      assert_response :forbidden
      get "/api/v1/private_meetings", headers: @headers
      assert_response :success
      assert_empty response.parsed_body["cohorts"]
      get "/api/v1/dashboard", headers: @headers, params: { cohort_id: @cohort.id }
      assert_response :success
      assert_equal false, response.parsed_body.dig("dashboard", "capabilities", "features", "recordings")
      assert_empty response.parsed_body.dig("dashboard", "office_hours")
      post "/api/v1/sessions", headers: @headers
      assert_equal false, response.parsed_body.dig("school", "features", "recordings")
    end
  end

  test "disabled announcements are hidden from lists and direct links" do
    announcement = Announcement.create!(title: "Synthetic update", body: "Practice", author: @admin, audience: :cohort, cohort: @cohort, published_at: Time.current)
    @cohort.update!(settings: { features: { announcements: false } })
    as_user(@student) do
      get "/api/v1/announcements", headers: @headers
      assert_response :success
      assert_empty response.parsed_body["announcements"]
      get "/api/v1/announcements/#{announcement.id}", headers: @headers
      assert_response :forbidden
    end
    as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/recordings", headers: @headers }
    assert_response :success
  end

  private

  def as_user(user, &block)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email } }
    @headers = { "Authorization" => "Bearer test_token" }
    block.call
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
