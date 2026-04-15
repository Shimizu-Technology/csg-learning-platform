require "test_helper"

class SubmissionsGradingTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp")
    @mod = CurriculumModule.create!(
      curriculum: @curriculum, name: "Prework", position: 0, day_offset: 0, schedule_days: "weekdays"
    )
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Git Basics", position: 0, release_day: 0)
    @block = ContentBlock.create!(
      lesson: @lesson, block_type: :exercise, position: 0, title: "Exercise 1", body: "Instructions"
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
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod, unlocked: true)

    @submission = Submission.create!(user: @student, content_block: @block, text: "my code")
  end

  test "staff can grade a submission with passing grade and it completes progress" do
    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "A", feedback: "Great work!" },
        headers: auth_headers, as: :json
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

  test "instructor can grade a submission" do
    as_user(@instructor) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "B", feedback: "Good" },
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
        params: { grade: "R", feedback: "Please redo" },
        headers: auth_headers, as: :json
    end

    assert_response :success
    @submission.reload
    assert_equal "R", @submission.grade

    progress = Progress.find_by(user: @student, content_block: @block)
    assert_nil(progress) || refute(progress&.completed?)
  end

  test "grading R then A transitions progress to completed" do
    as_user(@admin) do
      patch "/api/v1/submissions/#{@submission.id}/grade",
        params: { grade: "R", feedback: "Redo" },
        headers: auth_headers, as: :json
    end

    resubmission = Submission.create!(
      user: @student, content_block: @block, text: "fixed code", num_submissions: 2
    )

    as_user(@admin) do
      patch "/api/v1/submissions/#{resubmission.id}/grade",
        params: { grade: "A", feedback: "Fixed!" },
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

  test "student cannot update own graded submission" do
    @submission.update!(grade: :A, graded_by_id: @admin.id, graded_at: Time.current)

    as_user(@student) do
      patch "/api/v1/submissions/#{@submission.id}",
        params: { text: "sneaky update" },
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
