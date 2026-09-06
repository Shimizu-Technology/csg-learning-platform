require "test_helper"

class SubmissionsGradingTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Live Class", position: 0, day_offset: 0, schedule_days: "weekdays", module_type: :live_class
    )
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Git Basics", position: 0, release_day: 0, requires_submission: true)
    @block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 0, title: "Exercise 1", body: "Instructions", submission_type: :text_submission
    )
    @repo_block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 1, title: "Project 1", body: "Ship it", submission_type: :repo_and_live_url_submission
    )
    @repo_only_block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 2, title: "Repo Review", body: "Share the repo", submission_type: :repo_url_submission
    )
    @manual_block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 3, title: "Practice 1", body: "Do it", submission_type: :manual_complete
    )
    @challenge_block = ContentBlock.create!(
      lesson: @lesson, block_type: :code_challenge, position: 4, title: "Challenge 1", body: "Solve it", submission_type: :text_submission
    )

    @student = User.create!(
      clerk_id: "clerk_grade_student", email: "grade_student@example.com",
      first_name: "Student", last_name: "One", role: :student
    )
    @instructor = User.create!(
      clerk_id: "clerk_grade_instructor", email: "grade_instructor@example.com",
      first_name: "Instructor", last_name: "One", role: :instructor
    )
    @admin = User.create!(
      clerk_id: "clerk_grade_admin", email: "grade_admin@example.com",
      first_name: "Admin", last_name: "One", role: :admin
    )

    @cohort = Cohort.create!(
      curriculum: @curriculum, name: "Cohort", start_date: Date.current, status: :active
    )
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @mod, unlocked: true)

    @submission = Submission.create!(user: @student, content_block: @block, submission_type: :text_submission, text: "my code")
  end

  test "staff can grade a submission with passing grade and it completes progress" do
    expected_job = ->(args) { args[0] == "graded" && args[1] == @submission.id && Time.iso8601(args[2]) }
    assert_enqueued_with(job: SubmissionNotificationJob, args: expected_job) do
      as_user(@admin) do
        patch "/api/v1/submissions/#{@submission.id}/grade",
          params: grading_params(grade: "A", feedback: "Great work!"),
          headers: auth_headers, as: :json
      end
    end

    assert_response :success
    @submission.reload
    assert_equal "A", @submission.grade
    assert_equal "Great work!", @submission.feedback
    assert_equal @admin.id, @submission.graded_by_id
    assert_not_nil @submission.graded_at

    progress = Progress.find_by(user: @student, content_block: @block)
    assert_not_nil progress
    assert progress.completed?
    assert_not_nil progress.completed_at
  end

  test "staff grading rejects a stale submission version without overwriting it" do
    opened_at = @submission.updated_at.iso8601(6)
    @submission.update!(feedback: "A newer review")

    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "A", feedback: "Stale review", base_submission_updated_at: opened_at },
        headers: auth_headers, as: :json
    end

    assert_response :conflict
    assert_equal "stale_submission", response.parsed_body.fetch("code")
    assert_nil @submission.reload.grade
    assert_equal "A newer review", @submission.feedback
    assert_not Progress.exists?(user: @student, content_block: @block)
  end

  test "staff grading accepts the exact version returned by the submission API" do
    as_user(@admin) do
      get "/api/v1/submissions/#{@submission.id}", headers: auth_headers
    end
    opened_at = response.parsed_body.dig("submission", "updated_at")

    assert_equal @submission.updated_at.iso8601(6), opened_at

    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "B", feedback: "Current review", base_submission_updated_at: opened_at },
        headers: auth_headers, as: :json
    end

    assert_response :success
    assert_equal "B", @submission.reload.grade
    assert_equal "Current review", @submission.feedback
  end

  test "staff grading requires a submission version" do
    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "A", feedback: "Missing version" },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    assert_equal [ "base_submission_updated_at is required" ], response.parsed_body.fetch("errors")
    assert_nil @submission.reload.grade
  end

  test "staff grade rejects a request from before the enrollment restart" do
    @enrollment.update!(learning_state_reset_at: 1.minute.from_now)

    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grading_params(grade: "A", feedback: "Stale grade"),
        headers: auth_headers, as: :json
    end

    assert_response :conflict
    assert_nil @submission.reload.grade
    assert_not Progress.exists?(user: @student, content_block: @block)
  end

  test "student submission marks progress completed immediately" do
    expected_job = ->(args) { args[0] == "created" && args[1].is_a?(Integer) && Time.iso8601(args[2]) }
    assert_enqueued_with(job: SubmissionNotificationJob, args: expected_job) do
      as_user(@student) do
        post "/api/v1/submissions",
          params: { content_block_id: @block.id, text: "fresh code" },
          headers: auth_headers, as: :json
      end
    end

    assert_response :created
    assert JSON.parse(response.body).dig("submission", "updated_at").present?
    progress = Progress.find_by(user: @student, content_block: @block)
    assert_not_nil progress
    assert progress.completed?
    assert_not_nil progress.completed_at
  end

  test "submission records expose stable lesson and module relationships" do
    as_user(@admin) do
      get "/api/v1/submissions/#{@submission.id}", headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body).fetch("submission")
    assert_equal @lesson.id, payload.fetch("lesson_id")
    assert_equal @mod.id, payload.fetch("module_id")
    assert_equal @mod.name, payload.fetch("module_name")
    assert_equal @cohort.id, payload.fetch("cohort_id")
    assert_equal @cohort.name, payload.fetch("cohort_name")
  end

  test "submission context uses the newest active enrollment for the curriculum" do
    @enrollment.update!(enrolled_at: 2.days.ago)
    newer_cohort = Cohort.create!(curriculum: @curriculum, name: "New cohort", start_date: Date.current, status: :active)
    Enrollment.create!(user: @student, cohort: newer_cohort, status: :active, enrolled_at: 1.day.ago)

    as_user(@admin) do
      get "/api/v1/submissions/#{@submission.id}", headers: auth_headers
    end

    assert_response :success
    payload = response.parsed_body.fetch("submission")
    assert_equal newer_cohort.id, payload.fetch("cohort_id")
    assert_equal newer_cohort.name, payload.fetch("cohort_name")
  end

  test "student can submit repo and live url artifacts" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: {
          content_block_id: @repo_block.id,
          repo_url: "https://github.com/student/project",
          live_url: "https://student-project.example.com",
          pr_url: "https://github.com/student/project/pull/12",
          branch: "main",
          commit_sha: "abc1234",
          notes: "Ready for review"
        },
        headers: auth_headers, as: :json
    end

    assert_response :created
    submission = Submission.order(:created_at).last
    assert_equal "repo_and_live_url_submission", submission.submission_type
    assert_equal "https://github.com/student/project", submission.repo_url
    assert_equal "https://student-project.example.com", submission.live_url

    progress = Progress.find_by(user: @student, content_block: @repo_block)
    assert_not_nil progress
    assert progress.completed?
  end

  test "student can submit repo-only artifacts" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: {
          content_block_id: @repo_only_block.id,
          repo_url: "https://github.com/student/repo-only",
          notes: "Backend review requested"
        },
        headers: auth_headers, as: :json
    end

    assert_response :created
    submission = Submission.order(:created_at).last
    assert_equal "repo_url_submission", submission.submission_type
    assert_equal "https://github.com/student/repo-only", submission.repo_url
    assert_equal "Backend review requested", submission.notes

    progress = Progress.find_by(user: @student, content_block: @repo_only_block)
    assert_not_nil progress
    assert progress.completed?
  end

  test "code challenge text submission works like exercise text submission" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: { content_block_id: @challenge_block.id, text: "def solve; :ok end" },
        headers: auth_headers, as: :json
    end

    assert_response :created
    submission = Submission.order(:created_at).last
    assert_equal "text_submission", submission.submission_type
    assert_equal "def solve; :ok end", submission.text

    progress = Progress.find_by(user: @student, content_block: @challenge_block)
    assert_not_nil progress
    assert progress.completed?
  end

  test "manual-complete blocks reject direct submission creation" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: { content_block_id: @manual_block.id, text: "should fail" },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
  end

  test "text submission requires text payload" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: { content_block_id: @block.id, text: "   " },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    assert_equal "Submission text is required", JSON.parse(response.body).fetch("errors").first
  end

  test "repo-only submission requires repo url" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: { content_block_id: @repo_only_block.id, notes: "missing repo" },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    assert_equal "Repository URL is required", JSON.parse(response.body).fetch("errors").first
  end

  test "repo and live submission requires live url" do
    as_user(@student) do
      post "/api/v1/submissions",
        params: {
          content_block_id: @repo_block.id,
          repo_url: "https://github.com/student/project"
        },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    assert_equal "Live URL is required", JSON.parse(response.body).fetch("errors").first
  end

  test "instructor can grade a submission" do
    as_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grading_params(grade: "B", feedback: "Good"),
        headers: auth_headers, as: :json
    end

    assert_response :success
    @submission.reload
    assert_equal "B", @submission.grade
    assert_equal @instructor.id, @submission.graded_by_id
  end

  test "R grade does not mark progress as completed" do
    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grading_params(grade: "R", feedback: "Please redo"),
        headers: auth_headers, as: :json
    end

    assert_response :success
    @submission.reload
    assert_equal "R", @submission.grade

    progress = Progress.find_by(user: @student, content_block: @block)
    assert_not_nil progress
    assert progress.in_progress?
    assert_nil progress.completed_at
  end

  test "grading R then A transitions progress to completed" do
    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grading_params(grade: "R", feedback: "Redo"),
        headers: auth_headers, as: :json
    end

    first_progress = Progress.find_by(user: @student, content_block: @block)
    assert_not_nil first_progress
    assert first_progress.in_progress?

    resubmission = Submission.create!(
      user: @student, content_block: @block, text: "fixed code", num_submissions: 2
    )

    as_user(@admin) do
      patch "/api/v1/submissions/#{resubmission.id}/grade",
        params: grading_params(resubmission, grade: "A", feedback: "Fixed!"),
        headers: auth_headers, as: :json
    end

    assert_response :success
    progress = Progress.find_by(user: @student, content_block: @block)
    assert progress.completed?
  end

  test "student cannot grade a submission" do
    as_user(@student) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "A" },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "student can update own ungraded submission" do
    as_user(@student) do
      patch "/api/v1/submissions/#{@submission.id}",
        params: { text: "updated code" },
        headers: auth_headers, as: :json
    end

    assert_response :success
    assert_equal "updated code", @submission.reload.text
  end

  test "student cannot create or update submissions after the week is closed" do
    CohortModuleSubmissionWindow.create!(
      cohort: @cohort,
      curriculum_module: @mod,
      week_number: 1,
      submissions_close_at: 1.hour.ago,
      created_by: @admin
    )

    as_user(@student) do
      post "/api/v1/submissions",
        params: { content_block_id: @block.id, text: "late code" },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
    assert_match(/Submissions for Week 1 are closed/, JSON.parse(response.body).fetch("error"))

    as_user(@student) do
      patch "/api/v1/submissions/#{@submission.id}",
        params: { text: "late update" },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "student work progress is blocked after close but video progress remains allowed" do
    video_block = ContentBlock.create!(
      lesson: @lesson, block_type: :video, position: 5, title: "Video", video_url: "https://youtu.be/example"
    )
    CohortModuleSubmissionWindow.create!(
      cohort: @cohort,
      curriculum_module: @mod,
      week_number: 1,
      submissions_close_at: 1.hour.ago,
      created_by: @admin
    )

    as_user(@student) do
      patch "/api/v1/progress",
        params: { content_block_id: @manual_block.id, status: "completed" },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden

    as_user(@student) do
      patch "/api/v1/progress",
        params: { content_block_id: video_block.id, status: "completed" },
        headers: auth_headers, as: :json
    end

    assert_response :success
    assert Progress.find_by(user: @student, content_block: video_block).completed?
  end

  test "student cannot update own graded submission" do
    @submission.update!(grade: :A, graded_by_id: @admin.id, graded_at: Time.current)

    as_user(@student) do
      patch "/api/v1/submissions/#{@submission.id}",
        params: { text: "sneaky update" },
        headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  test "rubric grading stores criterion evidence and returns it to the student" do
    rubric = Rubric.create!(curriculum: @curriculum, title: "Project quality", rubric_criteria_attributes: [
      { title: "Correctness", description: "The solution works.", position: 0 },
      { title: "Clarity", description: "The approach is understandable.", position: 1 }
    ])
    correctness, clarity = rubric.rubric_criteria.ordered.to_a
    @block.update!(rubric: rubric)

    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: {
          grade: "B",
          feedback: "Strong work overall.",
          base_submission_updated_at: @submission.updated_at.iso8601(6),
          criterion_results: [
            { rubric_criterion_id: correctness.id, rating: "meets", feedback: "Required cases pass." },
            { rubric_criterion_id: clarity.id, rating: "developing", feedback: "Name the intermediate values." }
          ]
        },
        headers: auth_headers, as: :json
    end

    assert_response :success
    criteria = JSON.parse(response.body).dig("submission", "rubric", "criteria").index_by { |criterion| criterion["id"] }
    assert_equal "meets", criteria.fetch(correctness.id).fetch("rating")
    assert_equal "Name the intermediate values.", criteria.fetch(clarity.id).fetch("feedback")

    as_user(@student) do
      get "/api/v1/submissions/#{@submission.id}", headers: auth_headers
    end
    assert_response :success
    assert_equal "developing", JSON.parse(response.body).dig("submission", "rubric", "criteria", 1, "rating")
  end

  test "incomplete rubric results do not partially grade a submission" do
    rubric = Rubric.create!(curriculum: @curriculum, title: "Project quality", rubric_criteria_attributes: [
      { title: "Correctness", description: "The solution works.", position: 0 },
      { title: "Clarity", description: "The approach is understandable.", position: 1 }
    ])
    criterion = rubric.rubric_criteria.ordered.first
    @block.update!(rubric: rubric)

    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: grading_params(grade: "A", criterion_results: [ { rubric_criterion_id: criterion.id, rating: "meets" } ]),
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    assert_nil @submission.reload.grade
    assert_empty @submission.submission_criterion_results
  end

  private

  def grading_params(submission = @submission, **params)
    { base_submission_updated_at: submission.updated_at.iso8601(6) }.merge(params)
  end

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
