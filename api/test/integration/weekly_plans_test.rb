require "test_helper"

class WeeklyPlansTest < ActionDispatch::IntegrationTest
  def setup
    curriculum = Curriculum.create!(name: "Weekly API")
    mod = CurriculumModule.create!(curriculum: curriculum, name: "Week", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = Lesson.create!(curriculum_module: mod, title: "Today", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :checkpoint, position: 0, title: "Check")
    @student = User.create!(clerk_id: "weekly_api_student", email: "weekly-api@example.com", first_name: "API", last_name: "Student", role: :student)
    @staff = User.create!(clerk_id: "weekly_api_staff", email: "weekly-api-staff@example.com", first_name: "API", last_name: "Staff", role: :instructor)
    cohort = Cohort.create!(curriculum: curriculum, name: "Weekly", start_date: Date.current.beginning_of_week, status: :active)
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
