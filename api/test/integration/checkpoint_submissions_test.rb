require "test_helper"

# The Python pilot's weekly checkpoints are text submissions that staff grade.
class CheckpointSubmissionsTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Guided Python checkpoints", status: :active)
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Python", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Checkpoint 1", lesson_type: :checkpoint, position: 0, release_day: 0)
    @checkpoint = @lesson.content_blocks.create!(block_type: :checkpoint, position: 0, title: "Budget decision",
      filename: "budget_decision.py", submission_type: :text_submission)
    @quiz_lesson = Lesson.create!(curriculum_module: @mod, title: "Quick check", position: 1, release_day: 0)
    @quiz = @quiz_lesson.content_blocks.create!(block_type: :checkpoint, position: 0, title: "Quick check")

    @student = User.create!(clerk_id: "checkpoint_student", email: "checkpoint-student@example.com", first_name: "Maria", last_name: "Santos", role: :student)
    @waiting = User.create!(clerk_id: "checkpoint_waiting", email: "checkpoint-waiting@example.com", first_name: "Kai", last_name: "Cruz", role: :student)
    @admin = User.create!(clerk_id: "checkpoint_admin", email: "checkpoint-admin@example.com", first_name: "Ana", last_name: "Admin", role: :admin)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Pilot", start_date: LearningCalendar.today.beginning_of_week(:monday), status: :active)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    Enrollment.create!(user: @waiting, cohort: @cohort, status: :active)
  end

  test "submission checkpoints are distinguished from retrieval and toggle checkpoints" do
    assert @checkpoint.submission_checkpoint?
    assert @checkpoint.gradable_work_block?
    refute @quiz.submission_checkpoint?
    refute @quiz.gradable_work_block?
    assert_equal @checkpoint, @lesson.primary_assignment_block
    assert @lesson.effective_requires_submission
  end

  test "learner submits a checkpoint, staff grade it, and statuses follow the review" do
    as_user(@student) do
      post "/api/v1/submissions", params: { content_block_id: @checkpoint.id, cohort_id: @cohort.id,
        text: "amount = 75\nif amount < 100:\n    print(\"Under budget\")" }, headers: auth_headers, as: :json
    end
    assert_response :created
    submission = Submission.find(JSON.parse(response.body).dig("submission", "id"))
    assert_equal "text_submission", submission.submission_type
    assert_includes submission.text, "\n    print"

    as_user(@student) { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: auth_headers }
    block = JSON.parse(response.body).dig("lesson", "content_blocks").first
    assert_equal "text_submission", block.fetch("submission_type")
    assert_equal submission.id, block.fetch("submissions").first.fetch("id")
    assert JSON.parse(response.body).dig("lesson", "requires_submission")

    assert_equal "awaiting_review", dashboard_lesson.fetch("review_status")
    assert dashboard_lesson.fetch("completed"), "submitting finishes the learner's part"
    assert_equal "awaiting_review", weekly_item.fetch("review_status")

    as_user(@admin) { get "/api/v1/cohorts/#{@cohort.id}/modules/#{@mod.id}/submissions", headers: auth_headers }
    assert_response :success
    grading = JSON.parse(response.body)
    assert_equal [ @checkpoint.id ], grading.fetch("exercises").map { |exercise| exercise.fetch("id") }
    assert_equal 1, grading.fetch("students").find { |student| student.fetch("user_id") == @student.id }.fetch("ungraded")

    grade!(submission, "R", "Explain **why** with a test:\n\n```python\nprint(amount)\n```")
    assert_response :success
    assert_equal "redo_requested", dashboard_lesson.fetch("review_status")
    assert_equal "redo_requested", weekly_item.fetch("review_status")
    refute dashboard_lesson.fetch("completed")

    as_user(@student) do
      post "/api/v1/submissions", params: { content_block_id: @checkpoint.id, cohort_id: @cohort.id, text: "fixed" },
        headers: auth_headers, as: :json
    end
    assert_response :created
    resubmission = Submission.find(JSON.parse(response.body).dig("submission", "id"))
    assert_equal 2, resubmission.num_submissions
    assert_equal "awaiting_review", dashboard_lesson.fetch("review_status")

    grade!(resubmission, "A", "Nice")
    assert_equal "reviewed", dashboard_lesson.fetch("review_status")
  end

  test "lessons without reviewed work have no review status" do
    quiz = dashboard_lessons.find { |lesson| lesson.fetch("id") == @quiz_lesson.id }
    assert_nil quiz.fetch("review_status")
  end

  test "the learner dashboard says whether the course uses GitHub" do
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    assert_equal false, JSON.parse(response.body).dig("dashboard", "cohort", "requires_github")

    @cohort.update!(requires_github: true)
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_equal true, JSON.parse(response.body).dig("dashboard", "cohort", "requires_github")
  end

  test "staff see active learners who have no assigned module" do
    as_user(@admin) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    cohort = JSON.parse(response.body).dig("dashboard", "cohorts").first
    assert_equal 1, cohort.dig("cohort", "students_without_modules_count")
    waiting = cohort.fetch("students").find { |student| student.fetch("user_id") == @waiting.id }
    assert_equal 0, waiting.fetch("assigned_module_count")

    home = CohortHomeProjection.new(cohort: @cohort, viewer: @admin).call
    assert_equal 1, home.dig(:counts, :without_modules)
    assert_equal 0, home[:students].find { |student| student[:user_id] == @waiting.id }[:assigned_module_count]

    @cohort.update!(status: :upcoming)
    assert_equal 0, CohortHomeProjection.new(cohort: @cohort, viewer: @admin).call.dig(:counts, :without_modules)
  end

  test "direct progress cannot complete or reopen evidence driven blocks" do
    @checkpoint.create_knowledge_check!(prompt: "Pick one", options: [ "Yes", "No" ], correct_option: 0, explanation: "Yes")
    blocks = [ @checkpoint ]
    %i[text_submission repo_url_submission repo_and_live_url_submission prework_github_sync].each_with_index do |type, index|
      blocks << @lesson.content_blocks.create!(block_type: :exercise, position: index + 1, submission_type: type)
    end
    legacy = @lesson.content_blocks.create!(block_type: :exercise, position: 6, filename: "legacy.py")
    @cohort.update!(settings: { "module_github_config" => { @mod.id.to_s => { "requires_github" => true } } })
    blocks << legacy
    blocks.each do |block|
      progress = Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: :completed)
      %w[completed in_progress not_started].each do |status|
        as_user(@student) do
          patch "/api/v1/progress", params: { content_block_id: block.id, cohort_id: @cohort.id, status: status }, headers: auth_headers, as: :json
        end
        assert_response :unprocessable_entity
        assert_match(/retrieval check|submission|GitHub/, response.parsed_body.fetch("error"))
        assert progress.reload.completed?
      end
    end
  end

  test "manual practice and video progress remain writable" do
    %i[exercise video].each_with_index do |type, index|
      block = @lesson.content_blocks.create!(block_type: type, position: index + 1, submission_type: :manual_complete)
      %w[completed in_progress].each do |status|
        as_user(@student) do
          patch "/api/v1/progress", params: { content_block_id: block.id, cohort_id: @cohort.id, status: status }, headers: auth_headers, as: :json
        end
        assert_response :success
        assert_equal status, Progress.find_by!(enrollment: @enrollment, content_block: block).status
      end
    end
  end

  private

  def grade!(submission, grade, feedback)
    as_user(@admin) do
      patch "/api/v1/submissions/#{submission.id}/grade", params: { grade: grade, feedback: feedback,
        base_submission_updated_at: submission.reload.updated_at.iso8601(6) }, headers: auth_headers, as: :json
    end
    assert_response :success
  end

  def dashboard_lessons
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    JSON.parse(response.body).dig("dashboard", "modules").first.fetch("lessons")
  end

  def dashboard_lesson
    dashboard_lessons.find { |lesson| lesson.fetch("id") == @lesson.id }
  end

  def weekly_item
    as_user(@student) { get "/api/v1/weekly_plan", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    plan = JSON.parse(response.body).fetch("weekly_plan")
    (plan.fetch("required") + plan.fetch("optional")).find { |item| item.fetch("lesson_id") == @lesson.id }
  end

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
