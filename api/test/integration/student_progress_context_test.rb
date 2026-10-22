require "test_helper"

class StudentProgressContextTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Connected learning")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Foundations", position: 0)
    lesson = Lesson.create!(curriculum_module: @mod, title: "Relationships", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :text, title: "Connected records", position: 0)
    @student = User.create!(clerk_id: "context_student", email: "context@example.com", first_name: "Context", last_name: "Student", role: :student)
    @staff = User.create!(clerk_id: "context_staff", email: "staff-context@example.com", first_name: "Context", last_name: "Staff", role: :instructor)
    @active_cohort = Cohort.create!(curriculum: @curriculum, name: "Current cohort", start_date: Date.current, status: :active)
    @past_cohort = Cohort.create!(curriculum: @curriculum, name: "Past cohort", start_date: 1.year.ago, status: :completed)
    [ @active_cohort, @past_cohort ].each { |cohort| cohort.cohort_instructor_assignments.create!(user: @staff) }
    [ @active_cohort, @past_cohort ].each do |cohort|
      enrollment = Enrollment.create!(user: @student, cohort: cohort, status: cohort.active? ? :active : :completed)
      enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    end
  end

  test "staff progress resolves the explicitly requested enrollment" do
    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @past_cohort.id }, headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body)
    assert_equal @past_cohort.id, payload.dig("cohort", "id")
    assert_equal "completed", payload.dig("enrollment", "status")
    assert_equal "enrollment", payload.dig("learning_evidence_scope", "kind")
    assert_equal @curriculum.id, payload.dig("learning_evidence_scope", "curriculum_id")
    assert_equal 2, payload.dig("learning_evidence_scope", "enrollment_count")
    refute payload.dig("learning_evidence_scope", "shared_across_enrollments")
  end

  test "staff progress rejects a cohort the student never joined" do
    unrelated = Cohort.create!(curriculum: @curriculum, name: "Unrelated", start_date: Date.current, status: :active)

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: unrelated.id }, headers: auth_headers
    end

    assert_response :not_found
    assert_equal "Student is not enrolled in this cohort", JSON.parse(response.body).fetch("error")
  end

  test "lesson-only dashboard and staff progress count only assigned learning steps" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    enrollment.module_assignments.destroy_all
    assigned_lesson = @mod.lessons.first
    enrollment.lesson_assignments.create!(lesson: assigned_lesson, unlocked: true)
    sibling = @mod.lessons.create!(title: "Unassigned sibling", position: 1, release_day: 0)
    sibling.content_blocks.create!(block_type: :text, position: 0, body: "Not assigned")
    Progress.create!(user: @student, enrollment: enrollment, content_block: assigned_lesson.content_blocks.first, status: :completed)
    Progress.create!(user: @student, enrollment: enrollment, content_block: sibling.content_blocks.first, status: :completed)

    as_user(@student) do
      get "/api/v1/dashboard", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    dashboard = JSON.parse(response.body).fetch("dashboard")
    assert_equal({ "completed" => 1, "total" => 1, "percentage" => 100.0 }, dashboard.fetch("overall_progress"))
    mod = dashboard.fetch("modules").sole
    assert_equal @mod.id, mod.fetch("id")
    assert mod.fetch("available")
    assert_equal [ assigned_lesson.id ], mod.fetch("lessons").map { |lesson| lesson["id"] }
    assert_equal 1, mod.fetch("total_blocks")

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    assert_equal({ "completed" => 1, "total" => 1, "percentage" => 100.0 }, JSON.parse(response.body).fetch("overall_progress"))
  end

  test "staff retain removed module evidence without counting it as assigned work" do
    enrollment = @student.enrollments.find_by!(cohort: @active_cohort)
    block = @mod.lessons.first.content_blocks.first
    Progress.create!(user: @student, enrollment: enrollment, content_block: block, status: :completed)
    submission = Submission.create!(user: @student, enrollment: enrollment, content_block: block, grade: :A, feedback: "Saved feedback")
    retained_module = @curriculum.modules.create!(name: "Still assigned", position: 1)
    retained_lesson = retained_module.lessons.create!(title: "Current work", position: 0)
    retained_lesson.content_blocks.create!(block_type: :text, title: "Pending", position: 0)
    enrollment.module_assignments.create!(curriculum_module: retained_module)
    enrollment.module_assignments.find_by!(module_id: @mod.id).destroy!
    # A different enrollment's newer evidence must never replace this history.
    other_enrollment = @student.enrollments.find_by!(cohort: @past_cohort)
    Submission.create!(user: @student, enrollment: other_enrollment, content_block: block, grade: :R)

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: @active_cohort.id }, headers: auth_headers
    end
    assert_response :success
    payload = JSON.parse(response.body)
    removed = payload.fetch("modules").find { |mod| mod["id"] == @mod.id }
    saved = removed.fetch("lessons").sole.fetch("blocks").sole
    assert_equal "completed", saved.fetch("status")
    assert saved.fetch("completed_at")
    assert_equal submission.id, saved.dig("submission", "id")
    assert_equal "A", saved.dig("submission", "grade")
    assert_equal "Saved feedback", saved.dig("submission", "feedback")
    assert_equal false, removed.fetch("lessons").sole.fetch("assigned")
    assert_equal false, removed.fetch("lessons").sole.fetch("available")
    assert_equal 0, removed.fetch("completed_blocks")
    assert_equal 0, removed.fetch("total_blocks")
    assert_equal 0, removed.fetch("lessons").sole.fetch("total_blocks")
    assert_equal({ "completed" => 0, "total" => 1, "percentage" => 0.0 }, payload.fetch("overall_progress"))
    assert_includes payload.fetch("recent_activity").map { |activity| activity["content_block_id"] }, block.id
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
