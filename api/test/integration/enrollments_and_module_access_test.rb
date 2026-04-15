require "test_helper"

class EnrollmentsAndModuleAccessTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod1 = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @mod2 = CurriculumModule.create!(
      curriculum: @curriculum, name: "Live Class", position: 1, day_offset: 35, schedule_days: "mwf"
    )
    @lesson1 = Lesson.create!(curriculum_module: @mod1, title: "L1", position: 0, release_day: 0)
    @lesson2 = Lesson.create!(curriculum_module: @mod2, title: "L2", position: 0, release_day: 0)

    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active
    )

    @admin = User.create!(
      clerk_id: "clerk_enroll_admin", email: "enroll_admin@example.com",
      first_name: "Admin", last_name: "One", role: :admin
    )
    @student = User.create!(
      clerk_id: "clerk_enroll_student", email: "enroll_student@example.com",
      first_name: "Student", last_name: "One", role: :student
    )
  end

  test "creating enrollment auto-generates module assignments for all curriculum modules" do
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments",
        params: { user_id: @student.id },
        headers: auth_headers, as: :json
    end

    assert_response :created

    enrollment = Enrollment.find_by(user: @student, cohort: @cohort)
    assert_not_nil enrollment
    assert_equal 2, enrollment.module_assignments.count
    assert enrollment.module_assignments.exists?(module_id: @mod1.id)
    assert enrollment.module_assignments.exists?(module_id: @mod2.id)
  end

  test "enrollment sets enrolled_at timestamp" do
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments",
        params: { user_id: @student.id },
        headers: auth_headers, as: :json
    end

    enrollment = Enrollment.find_by(user: @student, cohort: @cohort)
    assert_not_nil enrollment.enrolled_at
  end

  test "duplicate enrollment returns error" do
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)

    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments",
        params: { user_id: @student.id },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
  end

  test "module_access with assigned: false removes assignments" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ma = ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod1, unlocked: true)
    LessonAssignment.create!(enrollment: enrollment, lesson: @lesson1, unlocked: true)

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access",
        params: { module_id: @mod1.id, assigned: false },
        headers: auth_headers, as: :json
    end

    assert_response :success
    refute ModuleAssignment.exists?(id: ma.id)
    refute LessonAssignment.exists?(enrollment: enrollment, lesson: @lesson1)
  end

  test "module_access with assigned: true creates assignments for all active enrollments" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access",
        params: { module_id: @mod1.id, assigned: true, unlocked: true },
        headers: auth_headers, as: :json
    end

    assert_response :success
    ma = ModuleAssignment.find_by(enrollment: enrollment, module_id: @mod1.id)
    assert_not_nil ma
    assert ma.unlocked?
  end

  test "student cannot create enrollments" do
    as_user(@student) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments",
        params: { user_id: @student.id },
        headers: auth_headers, as: :json
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
