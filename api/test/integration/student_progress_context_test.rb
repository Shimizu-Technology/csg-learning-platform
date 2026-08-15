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
    assert_equal "curriculum", payload.dig("learning_evidence_scope", "kind")
    assert_equal @curriculum.id, payload.dig("learning_evidence_scope", "curriculum_id")
    assert_equal 2, payload.dig("learning_evidence_scope", "enrollment_count")
    assert payload.dig("learning_evidence_scope", "shared_across_enrollments")
  end

  test "staff progress rejects a cohort the student never joined" do
    unrelated = Cohort.create!(curriculum: @curriculum, name: "Unrelated", start_date: Date.current, status: :active)

    as_user(@staff) do
      get "/api/v1/progress/student/#{@student.id}", params: { cohort_id: unrelated.id }, headers: auth_headers
    end

    assert_response :not_found
    assert_equal "Student is not enrolled in this cohort", JSON.parse(response.body).fetch("error")
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
