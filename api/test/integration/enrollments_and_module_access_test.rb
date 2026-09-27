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

  test "alumni enrollment unlocks every curriculum module" do
    @cohort.update!(cohort_type: :alumni)

    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments",
        params: { user_id: @student.id },
        headers: auth_headers, as: :json
    end

    assert_response :created
    assert_equal 2, Enrollment.find_by!(user: @student, cohort: @cohort).module_assignments.where(unlocked: true).count
  end

  test "new curriculum modules are assigned to active alumni" do
    @cohort.update!(cohort_type: :alumni)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)

    new_module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "New alumni workshop",
      position: 2,
      schedule_days: "weekdays"
    )

    assignment = enrollment.module_assignments.find_by!(module_id: new_module.id)
    assert assignment.unlocked?
  end

  test "reactivating alumni restores missing curriculum modules" do
    @cohort.update!(cohort_type: :alumni)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :paused)

    enrollment.update!(status: :active)

    assert_equal 2, enrollment.module_assignments.where(unlocked: true).count
  end

  test "converting an existing cohort to alumni completes its active enrollments" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod1, unlocked: false)

    @cohort.update!(cohort_type: :alumni)

    assert_equal 2, enrollment.module_assignments.where(unlocked: true).count
  end

  test "alumni modules cannot be removed from the cohort" do
    @cohort.update!(cohort_type: :alumni)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access",
        params: { module_id: @mod1.id, assigned: false },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    assert enrollment.module_assignments.exists?(module_id: @mod1.id)
  end

  test "an individual alumni module assignment cannot be locked or deleted" do
    @cohort.update!(cohort_type: :alumni)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    assignment = enrollment.module_assignments.find_by!(module_id: @mod1.id)

    as_user(@admin) do
      patch "/api/v1/module_assignments/#{assignment.id}",
        params: { unlocked: false, unlock_date_override: 1.month.from_now.to_date },
        headers: auth_headers, as: :json
    end

    assert_response :success
    assert assignment.reload.unlocked?
    assert_nil assignment.unlock_date_override

    as_user(@admin) do
      delete "/api/v1/module_assignments/#{assignment.id}", headers: auth_headers
    end

    assert_response :unprocessable_entity
    assert ModuleAssignment.exists?(assignment.id)
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

  test "cohort invitation is queued only after enrollment succeeds" do
    pending_student = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "pending-alumni@example.com",
      role: :student
    )

    assert_enqueued_with(job: SendUserInviteEmailJob) do
      as_user(@admin) do
        post "/api/v1/cohorts/#{@cohort.id}/enrollments",
          params: { user_id: pending_student.id, send_invite: true },
          headers: auth_headers, as: :json
      end
    end

    assert_response :created
    assert_equal "queued", pending_student.reload.invite_delivery_status
    assert_equal "queued", JSON.parse(response.body).dig("invitation", "status")
  end

  test "failed duplicate enrollment does not send an invitation" do
    pending_student = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "duplicate-pending-alumni@example.com",
      role: :student
    )
    Enrollment.create!(user: pending_student, cohort: @cohort, status: :active)

    assert_no_enqueued_jobs only: SendUserInviteEmailJob do
      as_user(@admin) do
        post "/api/v1/cohorts/#{@cohort.id}/enrollments",
          params: { user_id: pending_student.id, send_invite: true },
          headers: auth_headers, as: :json
      end
    end

    assert_response :unprocessable_entity
    assert_equal "not_sent", pending_student.reload.invite_delivery_status
  end

  test "module_access with assigned: false removes assignments" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ma = ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod1, unlocked: true)
    LessonAssignment.create!(enrollment: enrollment, lesson: @lesson1, unlocked: true)
    CohortModuleSchedule.create!(
      cohort: @cohort,
      curriculum_module: @mod1,
      start_date: @mod1.next_start_date_on_or_after(Date.current)
    )

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access",
        params: { module_id: @mod1.id, assigned: false },
        headers: auth_headers, as: :json
    end

    assert_response :success
    refute ModuleAssignment.exists?(id: ma.id)
    refute LessonAssignment.exists?(enrollment: enrollment, lesson: @lesson1)
    refute CohortModuleSchedule.exists?(cohort: @cohort, curriculum_module: @mod1)
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
    assert_equal @mod1.next_start_date_on_or_after(Date.current), CohortModuleSchedule.find_by!(cohort: @cohort, curriculum_module: @mod1).start_date
  end

  test "module_access stores explicit cohort module start dates" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access",
        params: { module_id: @mod1.id, assigned: true, module_start_date: "2026-05-04", unlocked: false },
        headers: auth_headers, as: :json
    end

    assert_response :success
    ma = ModuleAssignment.find_by!(enrollment: enrollment, module_id: @mod1.id)
    refute ma.unlocked?
    assert_equal Date.new(2026, 5, 4), CohortModuleSchedule.find_by!(cohort: @cohort, curriculum_module: @mod1).start_date
  end

  test "module_access without assigned rejects updates for unassigned modules" do
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)

    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/module_access",
        params: { module_id: @mod1.id, module_start_date: "2026-04-14" },
        headers: auth_headers, as: :json
    end

    assert_response :unprocessable_entity
    refute CohortModuleSchedule.exists?(cohort: @cohort, curriculum_module: @mod1)
  end

  test "module assignment update rejects a request from before restart" do
    enrollment = Enrollment.create!(
      user: @student,
      cohort: @cohort,
      status: :active,
      learning_state_reset_at: 1.minute.from_now
    )
    assignment = ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @mod1, unlocked: false)

    as_user(@admin) do
      patch "/api/v1/module_assignments/#{assignment.id}",
        params: { unlocked: true },
        headers: auth_headers, as: :json
    end

    assert_response :conflict
    assert_not assignment.reload.unlocked?
  end

  test "lesson assignment create rejects a request from before restart" do
    enrollment = Enrollment.create!(
      user: @student,
      cohort: @cohort,
      status: :active,
      learning_state_reset_at: 1.minute.from_now
    )

    as_user(@admin) do
      post "/api/v1/enrollments/#{enrollment.id}/lesson_assignments",
        params: { lesson_id: @lesson1.id, unlocked: true },
        headers: auth_headers, as: :json
    end

    assert_response :conflict
    assert_not LessonAssignment.exists?(enrollment: enrollment, lesson: @lesson1)
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
