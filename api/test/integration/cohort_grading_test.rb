require "test_helper"

class CohortGradingTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Live Class", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(
      curriculum_module: @mod,
      title: "Week 1 Day 1",
      position: 0,
      release_day: 0,
      requires_submission: false
    )
    @exercise = ContentBlock.create!(
      lesson: @lesson,
      block_type: :exercise,
      position: 0,
      title: "Practice exercise",
      body: "Do the work"
    )

    @student = User.create!(
      clerk_id: "clerk_cohort_grading_student",
      email: "cohort_grading_student@example.com",
      first_name: "Student",
      last_name: "One",
      role: :student
    )
    @admin = User.create!(
      clerk_id: "clerk_cohort_grading_admin",
      email: "cohort_grading_admin@example.com",
      first_name: "Admin",
      last_name: "One",
      role: :admin
    )

    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active
    )
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)
  end

  test "disabled GitHub sync hides grading actions and resolves preview type" do
    @exercise.update!(submission_type: "prework_github_sync")
    @cohort.update!(settings: { features: { github_sync: false } })
    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions", headers: auth_headers
      assert_response :success
      assert_equal false, response.parsed_body["github_sync_enabled"]
      assert_equal false, response.parsed_body["supports_github_sync"]
      assert_equal 0, response.parsed_body["open_github_sync_count"]
      assert_equal "text_submission", response.parsed_body.dig("exercises", 0, "submission_type")
      get "/api/v1/cohorts/#{@cohort.id}/student_view", headers: auth_headers
      assert_response :success
      assert_equal "text_submission", response.parsed_body.dig("student_view", "modules", 0, "lessons", 0, "submission_type")
    end
  end

  test "sync all names each student it could not finish and why" do
    @student.update!(github_username: "student-one")
    # Each student's sync refuses with a reason, without any GitHub HTTP.
    @cohort.update!(settings: { features: { github_sync: false } })
    previous_token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = "test-token"
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/sync_github", headers: auth_headers
      assert_response :success
      body = response.parsed_body
      assert_equal 0, body.fetch("synced")
      assert_equal [ "User #{@student.id}: GitHub sync is disabled for this course" ], body.fetch("errors")
      assert_equal [ { "user_id" => @student.id, "full_name" => "Student One", "errors" => [ "GitHub sync is disabled for this course" ] } ], body.fetch("failed_students")
    end
  ensure
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = previous_token
  end

  test "index says whether GitHub syncs on its own every hour" do
    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions", headers: auth_headers
      assert_response :success
      assert_equal false, response.parsed_body.fetch("github_auto_sync")
    end
    SchoolSetting.current.update!(features: SchoolSetting.current.features.merge("github_app" => true, "github_reconciliation" => true))
    @cohort.update!(settings: { features: { github_app: true, github_reconciliation: true } })
    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions", headers: auth_headers
      assert_equal true, response.parsed_body.fetch("github_auto_sync")
    end
  end

  test "index includes non submission exercises and progress state for grading views" do
    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions",
        headers: auth_headers, as: :json
    end

    assert_response :success

    body = JSON.parse(response.body)
    exercise = body.fetch("exercises").first
    progress = body.fetch("progresses").first
    student = body.fetch("students").first

    assert_equal @exercise.id, exercise.fetch("id")
    # Column headers link to their lesson (L-2.4).
    assert_equal @exercise.lesson_id, exercise.fetch("lesson_id")
    assert_nil exercise["filename"]
    assert_equal false, exercise.fetch("requires_submission")
    assert_equal "manual_complete", exercise.fetch("submission_type")
    assert_equal false, body.fetch("supports_github_sync")

    assert_equal @student.id, progress.fetch("user_id")
    assert_equal @exercise.id, progress.fetch("content_block_id")
    assert_equal "completed", progress.fetch("status")

    assert_equal 1, student.fetch("total_exercises")
    assert_equal 0, student.fetch("submitted")
  end

  test "index reuses submission window status when counting open GitHub sync exercises" do
    @exercise.update!(submission_type: "prework_github_sync", filename: "practice.md")
    @cohort.cohort_module_submission_windows.create!(
      curriculum_module: @mod,
      week_number: 1,
      submissions_close_at: 1.hour.ago,
      created_by: @admin
    )

    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions",
        headers: auth_headers, as: :json
    end

    assert_response :success

    body = JSON.parse(response.body)
    exercise = body.fetch("exercises").first

    assert_equal true, body.fetch("supports_github_sync")
    assert_equal 0, body.fetch("open_github_sync_count")
    assert_equal true, exercise.fetch("github_sync")
    assert_equal true, exercise.fetch("submission_window").fetch("submissions_closed")
  end

  test "index exposes the exact submission version required by grading clients" do
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "Ready for review")

    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions",
        headers: auth_headers, as: :json
    end

    assert_response :success
    returned_submission = response.parsed_body.fetch("submissions").sole
    assert_equal submission.updated_at.iso8601(6), returned_submission.fetch("updated_at")
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
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
