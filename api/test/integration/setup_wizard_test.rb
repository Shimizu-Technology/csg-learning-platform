require "test_helper"

class SetupWizardTest < ActionDispatch::IntegrationTest
  setup do
    @admin = User.create!(email: "setup-admin@example.test", clerk_id: "setup-admin", role: :admin)
    @curriculum = Curriculum.create!(name: "Synthetic curriculum", status: :active)
    @cohort = Cohort.create!(name: "Internal pilot", curriculum: @curriculum, start_date: LearningCalendar.today, course_delivery: "self_paced")
  end

  test "server readiness exposes booleans and previews catalog copy without saving" do
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/setup_readiness",
        params: { public_title: "Public course", public_description: "Learn useful skills", public_image_url: "https://example.test/course.png" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert response.parsed_body.dig("readiness", "catalog_copy")
    assert_equal false, response.parsed_body.dig("school_checkout", "enabled")
    assert response.parsed_body["school_checkout"].values.all? { |value| value == true || value == false }
    assert_nil @cohort.reload.public_title
  end

  test "future cohort defaults upcoming and current cohort active" do
    assert @cohort.active?
    future = Cohort.create!(name: "Future", curriculum: @curriculum, start_date: LearningCalendar.today + 10)
    assert future.upcoming?
  end

  test "catalog returns public copy and never internal name" do
    @cohort.update!(public_checkout_enabled: true, public_title: "Learn Ruby", public_description: "Build a project", public_image_url: "https://example.test/ruby.png")
    get "/api/v1/course_offerings"
    assert_response :success
    offering = response.parsed_body["offerings"].find { |row| row["id"] == @cohort.id }
    assert_equal "Learn Ruby", offering["name"]
    assert_equal "Build a project", offering["description"]
    assert_equal "https://example.test/ruby.png", offering["image_url"]
    refute_includes response.body, "Internal pilot"
  end

  test "batch enrollment reports rows and is idempotent" do
    rows = [ { email: "new@example.test", first_name: "New", last_name: "Learner" }, { email: "NEW@example.test" }, { email: "invalid" }, { email: @admin.email } ]
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: rows }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal %w[enrolled duplicate error error], response.parsed_body["results"].map { |r| r["status"] }
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: rows.first(1) }, headers: auth_headers, as: :json
      assert_equal "already_enrolled", response.parsed_body["results"].first["status"]
    end
    assert_equal 1, @cohort.enrollments.count
    assert_equal "New", User.find_by!(email: "new@example.test").first_name
  end

  test "cap and admin permissions" do
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: Array.new(201) { { email: "cap@example.test" } } }, headers: auth_headers, as: :json
      assert_response :unprocessable_entity
    end
    instructor = User.create!(email: "setup-instructor@example.test", clerk_id: "setup-instructor", role: :instructor)
    as_user(instructor) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: "no@example.test" } ] }, headers: auth_headers, as: :json
      assert_response :forbidden
      post "/api/v1/cohorts/#{@cohort.id}/setup_readiness", headers: auth_headers, as: :json
      assert_response :forbidden
    end
  end
  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
