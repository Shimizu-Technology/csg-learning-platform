require_relative "../support/model_coverage"

class EnrollmentTest < ModelCoverageTestCase
  test "active and read scopes expire exactly at the access deadline" do
    enrollment.update!(access_expires_at: 1.second.from_now)
    assert Enrollment.active.exists?(enrollment.id)
    enrollment.update!(status: :paused)
    assert_not Enrollment.active.exists?(enrollment.id)
    assert Enrollment.with_read_access.exists?(enrollment.id)
    enrollment.update!(status: :active, access_expires_at: Time.current)
    assert_not enrollment.active?
    assert_not Enrollment.active.exists?(enrollment.id)
    assert_not Enrollment.with_read_access.exists?(enrollment.id)
    assert_invalid Enrollment.new(user: student, cohort: course), :user_id, student.id
    other = Enrollment.create!(user: person, cohort: course)
    assert_database_rejects other, { user_id: student.id }, ActiveRecord::RecordNotUnique, constraint: "index_enrollments_on_user_id_and_cohort_id"
    assert_database_rejects enrollment, { self_paced_support_weeks: 0 }, constraint: "enrollment_support_weeks_positive"
  end

  test "pause cutoff uses Guam dates on either side of midnight" do
    enrollment.update!(status: :paused)
    assert_equal Date.new(2026, 4, 6), enrollment.pause_date
    assert_equal Time.current, enrollment.paused_at
    assert enrollment.content_available_for_read?(Time.utc(2026, 4, 6, 13, 59))
    assert_not enrollment.content_available_for_read?(Time.utc(2026, 4, 6, 14))
    enrollment.update!(status: :active)
    assert_nil enrollment.paused_at
  end

  test "guided deadlines include the final Guam day and snapshot agreed terms" do
    course.update!(course_delivery: "guided", guided_access_ends_on: Date.new(2026, 4, 6), guided_support_ends_on: Date.new(2026, 4, 6))
    assert_equal Time.utc(2026, 4, 6, 14), enrollment.access_expires_at
    course.update!(guided_access_ends_on: Date.new(2026, 4, 8))
    assert_equal Time.utc(2026, 4, 6, 14), enrollment.reload.access_expires_at
    travel_to Time.utc(2026, 4, 6, 14) do
      assert_not enrollment.active?
      assert_not enrollment.instructor_support_active?
    end
  end

  test "self paced support starts once and never outlives access" do
    course.update!(course_delivery: "self_paced")
    enrollment.update!(access_expires_at: 1.week.from_now)
    assert_not enrollment.instructor_support_active?
    enrollment.record_first_course_open!
    assert_equal Time.current, enrollment.first_opened_at
    assert_equal enrollment.access_expires_at, enrollment.support_expires_at
    first_opened = enrollment.first_opened_at
    travel 1.day
    enrollment.record_first_course_open!
    assert_equal first_opened, enrollment.reload.first_opened_at
  end

  test "restart guard rejects stale writes but accepts newer requests" do
    enrollment.update!(learning_state_reset_at: Time.current)
    assert_raises(Enrollment::StaleLearningWrite) { enrollment.with_learning_write_guard(request_started_at: Time.current) { flunk } }
    called = false
    enrollment.with_learning_write_guard(request_started_at: 1.second.from_now) { called = true }
    assert called
  end

  test "destroy removes assignments and nullifies historical work" do
    assignment = enrollment.module_assignments.create!(curriculum_module: mod)
    progress = Progress.create!(user: student, enrollment: enrollment, content_block: block)
    submission
    enrollment.destroy!
    assert_not ModuleAssignment.exists?(assignment.id)
    assert_nil progress.reload.enrollment_id
    assert_nil submission.reload.enrollment_id
  end
end
