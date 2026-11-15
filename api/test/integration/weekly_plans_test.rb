require "test_helper"

class WeeklyPlansTest < ActionDispatch::IntegrationTest
  def setup
    curriculum = Curriculum.create!(name: "Weekly API")
    mod = @mod = CurriculumModule.create!(curriculum: curriculum, name: "Week", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: mod, title: "Today", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :checkpoint, position: 0, title: "Check")
    @student = User.create!(clerk_id: "weekly_api_student", email: "weekly-api@example.com", first_name: "API", last_name: "Student", role: :student)
    @staff = User.create!(clerk_id: "weekly_api_staff", email: "weekly-api-staff@example.com", first_name: "API", last_name: "Staff", role: :instructor)
    cohort = @cohort = Cohort.create!(curriculum: curriculum, name: "Weekly", start_date: Date.current.beginning_of_week, status: :active)
    enrollment = Enrollment.create!(user: @student, cohort: cohort, status: :active)
    enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
  end

  test "student receives the authenticated weekly projection" do
    as_user(@student) { get "/api/v1/weekly_plan", headers: auth_headers }

    assert_response :success
    plan = JSON.parse(response.body).fetch("weekly_plan")
    assert plan.fetch("enrolled")
    assert_equal "Pacific/Guam", plan.fetch("timezone")
    assert plan.fetch("summary").key?("required_count")
  end

  test "staff cannot read a student-only weekly projection" do
    as_user(@staff) { get "/api/v1/weekly_plan", headers: auth_headers }

    assert_response :forbidden
  end

  test "unenrolled weekly response and dashboard omit enrollment-only data" do
    @student.enrollments.destroy_all
    as_user(@student) do
      get "/api/v1/weekly_plan", headers: auth_headers
      assert_response :success
      assert_equal({ "enrolled" => false, "timezone" => "Pacific/Guam" }, response.parsed_body.fetch("weekly_plan"))
      get "/api/v1/dashboard", headers: auth_headers
      assert_response :success
      assert_not response.parsed_body.fetch("dashboard").key?("resources")
    end
  end

  test "alumni receive a populated library plan" do
    @cohort.update!(cohort_type: :alumni)
    as_user(@student) { get "/api/v1/weekly_plan", headers: auth_headers }
    assert_response :success
    plan = response.parsed_body.fetch("weekly_plan")
    assert_equal "library", plan.fetch("mode")
    assert_equal 1, plan.fetch("library_summary").fetch("lesson_count")
  end

  test "weekly response includes scheduled events and future unlocks" do
    travel_to Time.find_zone!("Pacific/Guam").local(2026, 11, 16, 10) do
      @cohort.update!(start_date: Date.current)
      future = @mod.lessons.create!(title: "Tomorrow", position: 1, release_day: 1)
      event = OfficeHour.create!(cohort: @cohort, created_by: @staff, title: "Live help", starts_at: 1.hour.from_now, ends_at: 2.hours.from_now, meeting_url: "https://example.test/help", timezone: "Pacific/Guam", recurrence: :once)
      as_user(@student) { get "/api/v1/weekly_plan", headers: auth_headers }
      assert_response :success
      plan = response.parsed_body.fetch("weekly_plan")
      assert_includes plan.fetch("events").map { |row| row.fetch("office_hour_id") }, event.id
      assert_includes plan.fetch("upcoming_unlocks").map { |row| row.fetch("lesson_id") }, future.id
    end
  end

  test "staff with no accessible cohorts receives an empty dashboard" do
    as_user(@staff) { get "/api/v1/dashboard", headers: auth_headers }
    assert_response :success
    assert_equal [], response.parsed_body.fetch("dashboard").fetch("cohorts")
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
