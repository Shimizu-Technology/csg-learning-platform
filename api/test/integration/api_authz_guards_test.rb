require "test_helper"

class ApiAuthzGuardsTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp 2026")
    @module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Prework",
      position: 0,
      day_offset: 0
    )

    @available_lesson = Lesson.create!(
      curriculum_module: @module,
      title: "Git Basics",
      position: 0,
      release_day: 0
    )
    @future_lesson = Lesson.create!(
      curriculum_module: @module,
      title: "Future Lesson",
      position: 1,
      release_day: 7
    )

    @content_block = ContentBlock.create!(
      lesson: @available_lesson,
      block_type: :exercise,
      position: 0,
      title: "Exercise 1",
      body: "Instructions",
      solution: "secret solution"
    )
    ContentBlock.create!(
      lesson: @future_lesson,
      block_type: :exercise,
      position: 0,
      title: "Exercise 2",
      body: "Future instructions",
      solution: "future secret solution"
    )

    @student_one = User.create!(
      clerk_id: "clerk_student_1",
      email: "student1@example.com",
      first_name: "Student",
      last_name: "One",
      role: :student
    )
    @student_two = User.create!(
      clerk_id: "clerk_student_2",
      email: "student2@example.com",
      first_name: "Student",
      last_name: "Two",
      role: :student
    )
    @admin = User.create!(
      clerk_id: "clerk_admin_1",
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      role: :admin
    )

    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Cohort 3",
      start_date: Date.current,
      status: :active
    )
    @enrollment_one = Enrollment.create!(user: @student_one, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment_one, curriculum_module: @module, unlocked: true)

    @submission_one = Submission.create!(user: @student_one, content_block: @content_block, text: "mine")
    @submission_two = Submission.create!(user: @student_two, content_block: @content_block, text: "theirs")
  end

  test "student submissions index ignores foreign user_id filter" do
    as_user(@student_one) do
      get "/api/v1/submissions", params: { user_id: @student_two.id }, headers: auth_headers
    end

    assert_response :success
    user_ids = JSON.parse(response.body).fetch("submissions").map { |submission| submission["user_id"] }.uniq
    assert_equal [@student_one.id], user_ids
  end

  test "student cannot view another student's submission" do
    as_user(@student_one) do
      get "/api/v1/submissions/#{@submission_two.id}", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "staff can view any submission" do
    as_user(@admin) do
      get "/api/v1/submissions/#{@submission_two.id}", headers: auth_headers
    end

    assert_response :success
  end

  test "student module show hides solutions" do
    as_user(@student_one) do
      get "/api/v1/modules/#{@module.id}", headers: auth_headers
    end

    assert_response :success
    first_block = JSON.parse(response.body).dig("module", "lessons", 0, "content_blocks", 0)
    refute first_block.key?("solution")
  end

  test "student cannot access lesson before unlock date" do
    as_user(@student_one) do
      get "/api/v1/lessons/#{@future_lesson.id}", headers: auth_headers
    end

    assert_response :forbidden
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }

    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
