require "test_helper"

class GuidedCourseAccessTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Guided Python", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Python", position: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Variables", position: 0, release_day: 0)
    @student = User.create!(clerk_id: "guided_student", email: "guided@example.com", first_name: "Guided", role: :student)
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "December Python pilot",
      start_date: Date.new(2026, 12, 1),
      status: :active,
      cohort_type: :workshop,
      course_delivery: "guided",
      guided_access_ends_on: Date.new(2027, 3, 20),
      guided_support_ends_on: Date.new(2027, 1, 6)
    )
  end

  test "new guided enrollment snapshots inclusive Guam access and support dates" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort)

    assert_equal Time.find_zone!("Pacific/Guam").local(2027, 3, 21), enrollment.access_expires_at
    assert_equal Time.find_zone!("Pacific/Guam").local(2027, 1, 7), enrollment.support_expires_at
  end

  test "changing cohort defaults does not rewrite an existing enrollment" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    original_terms = enrollment.attributes.slice("access_expires_at", "support_expires_at")

    @cohort.update!(guided_access_ends_on: Date.new(2027, 4, 20), guided_support_ends_on: Date.new(2027, 2, 6))

    assert_equal original_terms, enrollment.reload.attributes.slice("access_expires_at", "support_expires_at")
  end

  test "support cutoff blocks learner messaging and contextual help while lessons remain available" do
    staff = User.create!(clerk_id: "guided_staff", email: "guided-staff@example.com", first_name: "Guide", role: :instructor)
    enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    channel = @cohort.channels.find_by!(name: "Class Chat")
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, staff ])

    travel_to Time.find_zone!("Pacific/Guam").local(2027, 1, 7) do
      assert enrollment.reload.active?
      refute enrollment.instructor_support_active?
      refute channel.can_post?(@student)
      refute conversation.can_post?(@student)

      error = assert_raises(HelpRequestContext::InvalidContext) do
        HelpRequestContext.resolve!(student: @student, cohort_id: @cohort.id, context_type: "lesson", context_id: @lesson.id)
      end
      assert_equal "Instructor support has ended for this course", error.message
    end
  end

  test "lesson access ends after the complete Guam end date" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort)

    travel_to Time.find_zone!("Pacific/Guam").local(2027, 3, 20, 23, 59, 59) do
      assert enrollment.reload.active?
    end

    travel_to Time.find_zone!("Pacific/Guam").local(2027, 3, 21) do
      refute enrollment.reload.active?
      refute Enrollment.active.exists?(enrollment.id)
    end
  end

  test "learner dashboard and staff progress preview expose the snapshotted guided terms" do
    enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)

    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @cohort.id }, headers: auth_headers
    end

    assert_response :success
    learner_access = JSON.parse(response.body).dig("dashboard", "course_access")
    assert_equal "guided", learner_access.fetch("course_delivery")
    assert_equal enrollment.access_expires_at.iso8601(3), learner_access.fetch("access_expires_at")
    assert_equal enrollment.support_expires_at.iso8601(3), learner_access.fetch("support_expires_at")

    admin = User.create!(clerk_id: "guided_admin", email: "guided-admin@example.com", first_name: "Admin", role: :admin)
    as_user(admin) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: auth_headers
    end

    assert_response :success
    staff_preview = JSON.parse(response.body)
    assert_equal "guided", staff_preview.dig("cohort", "course_delivery")
    assert_equal enrollment.access_expires_at.iso8601(3), staff_preview.dig("enrollment", "access_expires_at")
    assert_equal enrollment.support_expires_at.iso8601(3), staff_preview.dig("enrollment", "support_expires_at")
  end

  test "program enrollment keeps indefinite access" do
    program = Cohort.create!(curriculum: @curriculum, name: "Full program", start_date: Date.current, course_delivery: "program")
    enrollment = Enrollment.create!(user: @student, cohort: program)

    assert_nil enrollment.access_expires_at
    assert_nil enrollment.support_expires_at
    assert enrollment.instructor_support_active?
  end

  test "support cannot extend beyond lesson access" do
    @cohort.guided_access_ends_on = Date.new(2027, 1, 1)
    @cohort.guided_support_ends_on = Date.new(2027, 1, 2)

    refute @cohort.valid?
    assert_includes @cohort.errors[:guided_support_ends_on], "must be on or before lesson access ends"
  end

  test "malformed guided dates are rejected instead of silently becoming indefinite" do
    @cohort.guided_access_ends_on = "2027-02-30"

    refute @cohort.valid?
    assert_includes @cohort.errors[:guided_access_ends_on], "is invalid"
  end

  test "guided dates cannot be attached to a full program" do
    @cohort.course_delivery = "program"

    refute @cohort.valid?
    assert_includes @cohort.errors[:course_delivery], "must be guided to set guided access dates"
  end

  private

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
