require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

# A grade in flight while an admin switches the curriculum's grading scale. The grade takes the
# curriculum FOR SHARE before its enrollment and submission (Curriculum.lock_for_content!), so it
# waits for the scale change (curricula#update holds the row FOR UPDATE) and then checks the
# grade against the new scale: a B started on A / B / C / Redo is refused once the curriculum is
# Pass / Redo, and nothing is written.
class GradingScaleRacesTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Scale race #{slug}")
    mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "weekdays")
    lesson = Lesson.create!(curriculum_module: mod, title: "Loops", position: 0, release_day: 0, requires_submission: true)
    @block = ContentBlock.create!(lesson: lesson, block_type: :exercise, position: 0, title: "Loop", body: "Write one", submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Scale race #{slug}", start_date: Date.current, status: :active)
    @instructor = User.create!(clerk_id: "scale_race_staff_#{slug}", email: "scale-race-staff-#{slug}@example.invalid", first_name: "Ina", last_name: "Synthetic", role: :instructor)
    @student = User.create!(clerk_id: "scale_race_student_#{slug}", email: "scale-race-student-#{slug}@example.invalid", first_name: "Sam", last_name: "Synthetic", role: :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @block, submission_type: :text_submission, text: "loop")
    @users = [ @instructor, @student ]
    @threads = []
    @original_verify = ClerkAuth.method(:verify)
    payload = { "sub" => @instructor.clerk_id, "email" => @instructor.email, "first_name" => "Ina", "last_name" => "Synthetic" }
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
  end

  teardown do
    finish_test_threads(@threads)
    ClerkAuth.define_singleton_method(:verify, @original_verify) if @original_verify
    ActivityEvent.where(cohort_id: @cohort&.id).delete_all
    Progress.where(enrollment_id: @enrollment&.id).delete_all
    Submission.where(id: @submission&.id).delete_all
    Notification.where(user_id: @users.map(&:id)).delete_all
    Enrollment.where(id: @enrollment&.id).delete_all
    CohortInstructorAssignment.where(user_id: @users.map(&:id)).delete_all
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@users)
  end

  test "a B in flight waits for a switch to Pass / Redo and is then refused" do
    params = { grade: "B", feedback: "Nice", base_submission_updated_at: @submission.updated_at.iso8601(6) }
    Curriculum.transaction do
      @curriculum.lock!
      holder = Curriculum.connection.select_value("SELECT pg_backend_pid()")
      @threads = [ Thread.new { send_grade(params) } ]
      wait_for_lock_waiters(holder, workers: @threads)
      @curriculum.update!(grading_scale: "pass_redo")
    end
    status, body = @threads.first.join(30) && @threads.first.value

    assert_equal 422, status
    assert_equal [ "Grade must be Pass or Redo." ], body["errors"]
    assert_nil @submission.reload.grade
    assert_nil @submission.graded_at
  end

  private

  def send_grade(params)
    ActiveRecord::Base.connection_pool.with_connection do
      session = ActionDispatch::Integration::Session.new(Rails.application)
      session.patch "/api/v1/submissions/#{@submission.id}/grade", params: params, headers: { "Authorization" => "Bearer test_token" }, as: :json
      [ session.response.status, session.response.parsed_body ]
    end
  end
end
