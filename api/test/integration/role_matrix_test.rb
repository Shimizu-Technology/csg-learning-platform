require "test_helper"

class RoleMatrixTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active
    )

    @student = User.create!(
      clerk_id: "clerk_role_student", email: "role_student@example.com",
      first_name: "Student", last_name: "One", role: :student
    )
    @instructor = User.create!(
      clerk_id: "clerk_role_instructor", email: "role_instructor@example.com",
      first_name: "Instructor", last_name: "One", role: :instructor
    )
    @admin = User.create!(
      clerk_id: "clerk_role_admin", email: "role_admin@example.com",
      first_name: "Admin", last_name: "One", role: :admin
    )
  end

  # --- Dashboard ---

  test "student gets student dashboard" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)

    as_user(@student) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)["dashboard"]
    assert_equal "student", data["user"]["role"]
  end

  test "instructor gets admin dashboard" do
    as_user(@instructor) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
    data = JSON.parse(response.body)["dashboard"]
    assert data.key?("cohorts") || data.key?("cohort")
  end

  test "admin gets admin dashboard" do
    as_user(@admin) do
      get "/api/v1/dashboard", headers: auth_headers
    end

    assert_response :success
  end

  # --- Cohorts (staff = instructor + admin) ---

  test "student cannot list cohorts" do
    as_user(@student) do
      get "/api/v1/cohorts", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can list cohorts" do
    as_user(@instructor) do
      get "/api/v1/cohorts", headers: auth_headers
    end

    assert_response :success
  end

  test "instructor cannot create cohort (admin-only)" do
    as_user(@instructor) do
      post "/api/v1/cohorts",
        params: { name: "New", curriculum_id: @curriculum.id, start_date: Date.current },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "admin can create cohort" do
    as_user(@admin) do
      post "/api/v1/cohorts",
        params: { name: "New", curriculum_id: @curriculum.id, start_date: Date.current },
        headers: auth_headers, as: :json
    end

    assert_response :created
  end

  # --- Curricula (staff for read, admin for write) ---

  test "student cannot list curricula" do
    as_user(@student) do
      get "/api/v1/curricula", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can list curricula" do
    as_user(@instructor) do
      get "/api/v1/curricula", headers: auth_headers
    end

    assert_response :success
  end

  # --- Users (admin-only) ---

  test "student cannot list users" do
    as_user(@student) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "instructor can list users (staff read access)" do
    as_user(@instructor) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :success
  end

  test "instructor cannot create users (admin-only)" do
    as_user(@instructor) do
      post "/api/v1/users",
        params: { user: { email: "new@example.com", first_name: "New", role: "student" } },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "admin can list users" do
    as_user(@admin) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :success
  end

  # --- Submissions grade (staff-only) ---

  test "student cannot access grade endpoint" do
    lesson = Lesson.create!(curriculum_module: @mod, title: "L", position: 0, release_day: 0)
    block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "E", body: "B")
    submission = Submission.create!(user: @student, content_block: block, text: "code")

    as_user(@student) do
      patch "/api/v1/submissions/#{submission.id}/grade",
        params: { grade: "A" }, headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id, "email" => user.email,
      "first_name" => user.first_name, "last_name" => user.last_name
    }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
