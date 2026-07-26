require "test_helper"

class EnrollmentRestartsTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Live class")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0)
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Day 1", position: 0, release_day: 0)
    @block = ContentBlock.create!(lesson: @lesson, block_type: :exercise, title: "Practice", position: 0)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 7", start_date: Date.current, status: :active)

    @other_curriculum = Curriculum.create!(name: "Workshop")
    other_mod = CurriculumModule.create!(curriculum: @other_curriculum, name: "Workshop", position: 0)
    other_lesson = Lesson.create!(curriculum_module: other_mod, title: "Workshop lesson", position: 0, release_day: 0)
    @other_block = ContentBlock.create!(lesson: other_lesson, block_type: :text, title: "Keep me", position: 0)

    @student = User.create!(clerk_id: "restart_student", email: "restart@example.com", role: :student)
    @admin = User.create!(clerk_id: "restart_admin", email: "restart-admin@example.com", role: :admin)
    @instructor = User.create!(clerk_id: "restart_instructor", email: "restart-instructor@example.com", role: :instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :completed, completed_at: 1.day.ago, enrolled_at: 2.months.ago)
    @module_assignment = ModuleAssignment.create!(
      enrollment: @enrollment,
      curriculum_module: @mod,
      unlocked: true,
      unlock_date_override: Date.current - 10.days
    )
    LessonAssignment.create!(enrollment: @enrollment, lesson: @lesson, unlocked: true)

    @progress = Progress.create!(user: @student, content_block: @block, status: :completed)
    @submission = Submission.create!(user: @student, content_block: @block, text: "Original work", grade: :A, grader: @instructor)
    @recording = Recording.create!(
      cohort: @cohort,
      uploaded_by: @admin,
      title: "Class replay",
      s3_key: "recordings/restart-test.mp4",
      content_type: "video/mp4",
      file_size: 100,
      position: 0
    )
    WatchProgress.create!(user: @student, recording: @recording, last_position_seconds: 20, total_watched_seconds: 20)
    Notification.create!(
      user: @admin,
      actor: @student,
      notifiable: @submission,
      notification_type: :submission,
      title: "Submission ready",
      path: "/admin/submissions/#{@submission.id}"
    )

    @other_progress = Progress.create!(user: @student, content_block: @other_block, status: :completed)
  end

  test "admin can restart one enrollment with a recoverable audit snapshot" do
    as_user(@admin) do
      post "/api/v1/enrollments/#{@enrollment.id}/restart",
        params: { confirmation: @student.email, reason: "Restarting with the next live class" },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_not Progress.exists?(@progress.id)
    assert_not Submission.exists?(@submission.id)
    assert_not WatchProgress.exists?(user: @student, recording: @recording)
    assert_empty @enrollment.lesson_assignments.reload
    assert_nil @module_assignment.reload.unlock_date_override
    assert @enrollment.reload.active?
    assert_nil @enrollment.completed_at
    assert_in_delta Time.current.to_i, @enrollment.enrolled_at.to_i, 3
    assert Progress.exists?(@other_progress.id), "progress from another curriculum must be preserved"

    restart = EnrollmentRestart.find(JSON.parse(response.body).dig("restart", "id"))
    assert_equal @student, restart.student
    assert_equal @admin, restart.performed_by
    assert_equal "Restarting with the next live class", restart.reason
    assert_equal 1, restart.records_removed.fetch("submissions")
    assert_equal "Original work", restart.snapshot.fetch("submissions").sole.fetch("text")
    assert_equal "Submission ready", restart.snapshot.fetch("submission_notifications").sole.fetch("title")
  end

  test "restart requires an admin and exact student email confirmation" do
    as_user(@instructor) do
      post "/api/v1/enrollments/#{@enrollment.id}/restart",
        params: { confirmation: @student.email },
        headers: auth_headers,
        as: :json
    end
    assert_response :forbidden

    as_user(@admin) do
      post "/api/v1/enrollments/#{@enrollment.id}/restart",
        params: { confirmation: "wrong@example.com" },
        headers: auth_headers,
        as: :json
    end
    assert_response :unprocessable_entity
    assert Progress.exists?(@progress.id)
  end

  test "restart refuses progress shared by any other same-curriculum enrollment" do
    second_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 8", start_date: Date.current, status: :active)
    Enrollment.create!(user: @student, cohort: second_cohort, status: :dropped)

    as_user(@admin) do
      post "/api/v1/enrollments/#{@enrollment.id}/restart",
        params: { confirmation: @student.email },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert Progress.exists?(@progress.id)
    assert_equal 0, EnrollmentRestart.count
  end

  test "learning write guard rejects requests that started before a restart" do
    request_started_at = Time.current
    @enrollment.update!(learning_state_reset_at: request_started_at + 1.second)

    error = assert_raises(Enrollment::StaleLearningWrite) do
      @enrollment.with_learning_write_guard(request_started_at: request_started_at) do
        flunk "stale write must not run"
      end
    end

    assert_match "restarted", error.message
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
