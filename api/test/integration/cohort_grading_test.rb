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
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)
    Progress.create!(user: @student, content_block: @exercise, status: :completed)
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
