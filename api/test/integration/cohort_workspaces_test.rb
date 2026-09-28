require "test_helper"

class CohortWorkspacesTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Cohort workspace curriculum")
    @first = Cohort.create!(curriculum: @curriculum, name: "First course", start_date: Date.current, status: :active)
    @second = Cohort.create!(curriculum: @curriculum, name: "Second course", start_date: Date.current - 1.week, status: :completed)
    @other = Cohort.create!(curriculum: @curriculum, name: "Private course", start_date: Date.current - 2.weeks, status: :active)
    @admin = User.create!(clerk_id: "workspace_admin", email: "workspace-admin@example.com", role: :admin)
    @instructor = User.create!(clerk_id: "workspace_instructor", email: "workspace-instructor@example.com", role: :instructor)
    @student = User.create!(clerk_id: "workspace_student", email: "workspace-student@example.com", role: :student)
    @peer = User.create!(clerk_id: "workspace_peer", email: "workspace-peer@example.com", role: :student)
    @first.cohort_instructor_assignments.create!(user: @instructor)
    Enrollment.create!(user: @student, cohort: @first, status: :active)
    Enrollment.create!(user: @student, cohort: @second, status: :completed)
    Enrollment.create!(user: @peer, cohort: @first, status: :active)
    Enrollment.create!(user: @peer, cohort: @other, status: :active)
  end

  test "switcher lists only the cohorts accessible to each role" do
    as_user(@admin) { get "/api/v1/cohorts/accessible", headers: auth_headers }
    assert_response :success
    assert_equal [ @first.id, @second.id, @other.id ].sort, cohort_ids.sort

    as_user(@instructor) { get "/api/v1/cohorts/accessible", headers: auth_headers }
    assert_response :success
    assert_equal [ @first.id ], cohort_ids
    assert_equal @first.workspace.id, JSON.parse(response.body).dig("cohorts", 0, "workspace_id")

    as_user(@student) { get "/api/v1/cohorts/accessible", headers: auth_headers }
    assert_response :success
    assert_equal [ @first.id, @second.id ].sort, cohort_ids.sort
    assert_equal [ "active", "completed" ].sort, JSON.parse(response.body).fetch("cohorts").map { |cohort| cohort.fetch("enrollment_status") }.sort
  end

  test "an instructor loses cohort data immediately after the admin revokes an assignment" do
    as_user(@instructor) { get "/api/v1/cohorts/#{@first.id}/home", headers: auth_headers }
    assert_response :success
    assert_equal 2, JSON.parse(response.body).dig("home", "counts", "active_students")

    as_user(@instructor) { get "/api/v1/cohorts/#{@other.id}/home", headers: auth_headers }
    assert_response :forbidden
    as_user(@instructor) { get "/api/v1/dashboard", params: { cohort_id: @other.id }, headers: auth_headers }
    assert_response :forbidden

    as_user(@admin) do
      delete "/api/v1/cohorts/#{@first.id}/instructor_assignments/#{@instructor.id}", headers: auth_headers
    end
    assert_response :no_content

    as_user(@instructor) { get "/api/v1/cohorts/accessible", headers: auth_headers }
    assert_empty cohort_ids
    as_user(@instructor) { get "/api/v1/cohorts/#{@first.id}/home", headers: auth_headers }
    assert_response :forbidden
    as_user(@instructor) { get "/api/v1/cohorts/#{@first.id}", headers: auth_headers }
    assert_response :forbidden
  end

  test "only an admin can assign an instructor to another cohort" do
    as_user(@instructor) do
      post "/api/v1/cohorts/#{@other.id}/instructor_assignments",
        params: { user_id: @instructor.id }, headers: auth_headers, as: :json
    end
    assert_response :forbidden

    as_user(@admin) do
      post "/api/v1/cohorts/#{@other.id}/instructor_assignments",
        params: { user_id: @instructor.id }, headers: auth_headers, as: :json
    end
    assert_response :created

    as_user(@instructor) { get "/api/v1/cohorts/#{@other.id}/home", headers: auth_headers }
    assert_response :success
    assert_equal @other.id, JSON.parse(response.body).dig("home", "cohort", "id")
  end

  test "instructors cannot inspect or change learning assignments in unassigned cohorts" do
    curriculum_module = @curriculum.modules.create!(name: "Private module", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = curriculum_module.lessons.create!(title: "Private lesson", position: 0, release_day: 0)
    enrollment = @other.enrollments.find_by!(user: @peer)
    module_assignment = enrollment.module_assignments.create!(curriculum_module: curriculum_module, unlocked: true)
    lesson_assignment = enrollment.lesson_assignments.create!(lesson: lesson, unlocked: true)

    as_user(@instructor) do
      get "/api/v1/enrollments/#{enrollment.id}/module_assignments", headers: auth_headers
      assert_response :forbidden
      get "/api/v1/module_assignments/#{module_assignment.id}", headers: auth_headers
      assert_response :forbidden
      patch "/api/v1/module_assignments/#{module_assignment.id}", params: { unlocked: false }, headers: auth_headers
      assert_response :forbidden
      get "/api/v1/enrollments/#{enrollment.id}/lesson_assignments", headers: auth_headers
      assert_response :forbidden
      get "/api/v1/lesson_assignments/#{lesson_assignment.id}", headers: auth_headers
      assert_response :forbidden
      patch "/api/v1/lesson_assignments/#{lesson_assignment.id}", params: { unlocked: false }, headers: auth_headers
      assert_response :forbidden
    end
    assert module_assignment.reload.unlocked?
    assert lesson_assignment.reload.unlocked?
  end

  test "student home shows own cohort information without staff counts or peer records" do
    as_user(@student) { get "/api/v1/cohorts/#{@first.id}/home", headers: auth_headers }
    assert_response :success
    home = JSON.parse(response.body).fetch("home")
    assert_equal @first.id, home.dig("cohort", "id")
    assert home.key?("own_progress_percentage")
    refute home.key?("counts")
    refute home.key?("students")
    refute_includes response.body, @peer.email

    as_user(@student) { get "/api/v1/cohorts/#{@second.id}/home", headers: auth_headers }
    assert_response :success
    as_user(@student) { get "/api/v1/cohorts/#{@other.id}/home", headers: auth_headers }
    assert_response :forbidden
  end

  test "selected dashboards use an authorized cohort" do
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @first.id }, headers: auth_headers }
    assert_response :success
    assert_equal @first.id, JSON.parse(response.body).dig("dashboard", "cohort", "id")

    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: @other.id }, headers: auth_headers }
    assert_response :forbidden

    as_user(@instructor) { get "/api/v1/dashboard", params: { cohort_id: @first.id }, headers: auth_headers }
    assert_response :success
    assert_equal [ @first.id ], JSON.parse(response.body).dig("dashboard", "cohorts").map { |cohort| cohort.dig("cohort", "id") }
  end

  test "messages stay within cohort access and completed cohort history is read only" do
    @student.update!(community_terms_version: CommunityPolicy::VERSION, community_terms_accepted_at: Time.current)
    first_channel = @first.channels.find_by!(name: "Class Chat")
    completed_channel = @second.channels.find_by!(name: "Class Chat")
    private_channel = @other.channels.find_by!(name: "Class Chat")
    Message.create!(channel: completed_channel, author: @admin, body: "Course recap")

    as_user(@student) { get "/api/v1/channels", headers: auth_headers }
    assert_response :success
    visible_ids = JSON.parse(response.body).fetch("channels").map { |channel| channel.fetch("id") }
    assert_includes visible_ids, first_channel.id
    assert_includes visible_ids, completed_channel.id
    refute_includes visible_ids, private_channel.id

    as_user(@student) { get "/api/v1/channels/#{completed_channel.id}", headers: auth_headers }
    assert_response :success
    assert_equal "Course recap", JSON.parse(response.body).fetch("messages").sole.fetch("body")

    as_user(@student) do
      post "/api/v1/channels/#{completed_channel.id}/messages",
        params: { body: "New message" }, headers: auth_headers, as: :json
    end
    assert_response :forbidden

    as_user(@student) { get "/api/v1/channels/#{private_channel.id}", headers: auth_headers }
    assert_response :forbidden
    as_user(@instructor) { get "/api/v1/channels/#{private_channel.id}", headers: auth_headers }
    assert_response :forbidden
  end

  test "module access respects the selected enrollment when curricula are shared" do
    curriculum_module = @curriculum.modules.create!(name: "Shared foundation", position: 0, day_offset: 0, schedule_days: "daily")
    lesson = curriculum_module.lessons.create!(title: "Getting started", position: 0, release_day: 0)
    lesson.content_blocks.create!(block_type: :text, title: "Welcome", position: 0)
    first_enrollment = @first.enrollments.find_by!(user: @student)
    first_enrollment.module_assignments.create!(curriculum_module: curriculum_module, unlocked: true)
    alternate = Cohort.create!(curriculum: @curriculum, name: "Alternate course", start_date: Date.current, status: :active)
    Enrollment.create!(user: @student, cohort: alternate, status: :active)

    as_user(@student) do
      get "/api/v1/modules/#{curriculum_module.id}", params: { cohort_id: @first.id }, headers: auth_headers
    end
    assert_response :success

    as_user(@student) do
      get "/api/v1/modules/#{curriculum_module.id}", params: { cohort_id: alternate.id }, headers: auth_headers
    end
    assert_response :forbidden
  end

  test "shared curriculum progress and submissions belong to the selected cohort" do
    curriculum_module = @curriculum.modules.create!(name: "Shared exercises", position: 0, day_offset: 0, schedule_days: "daily")
    reading = curriculum_module.lessons.create!(title: "Read first", position: 0, release_day: 0)
    reading_block = reading.content_blocks.create!(block_type: :text, title: "Read", position: 0)
    exercise_lesson = curriculum_module.lessons.create!(title: "Submit work", position: 1, release_day: 0)
    exercise = exercise_lesson.content_blocks.create!(block_type: :exercise, title: "Solution", position: 0, submission_type: :text_submission)
    first_enrollment = @first.enrollments.find_by!(user: @student)
    first_enrollment.module_assignments.create!(curriculum_module: curriculum_module, unlocked: true)
    alternate = Cohort.create!(curriculum: @curriculum, name: "Parallel course", start_date: Date.current, status: :active)
    alternate_enrollment = Enrollment.create!(user: @student, cohort: alternate, status: :active)
    alternate_enrollment.module_assignments.create!(curriculum_module: curriculum_module, unlocked: true)

    as_user(@student) do
      patch "/api/v1/progress", params: { content_block_id: reading_block.id, status: "completed", cohort_id: @first.id }, headers: auth_headers
    end
    assert_response :success
    as_user(@student) do
      post "/api/v1/submissions", params: { content_block_id: exercise.id, text: "First course work", cohort_id: @first.id }, headers: auth_headers
    end
    assert_response :created
    assert_equal [ first_enrollment.id ], Progress.where(user: @student, content_block: reading_block).pluck(:enrollment_id)
    assert_equal [ first_enrollment.id ], Submission.where(user: @student, content_block: exercise).pluck(:enrollment_id)

    as_user(@student) { get "/api/v1/cohorts/#{alternate.id}/home", headers: auth_headers }
    assert_equal 0, JSON.parse(response.body).dig("home", "own_progress_percentage")
    as_user(@student) { get "/api/v1/dashboard", params: { cohort_id: alternate.id }, headers: auth_headers }
    assert_equal 0, JSON.parse(response.body).dig("dashboard", "overall_progress", "completed")
    as_user(@admin) do
      get "/api/v1/cohorts/#{alternate.id}/modules/#{curriculum_module.id}/submissions", headers: auth_headers
    end
    assert_empty JSON.parse(response.body).fetch("submissions")
    as_user(@admin) { get "/api/v1/cohorts/#{alternate.id}/home", headers: auth_headers }
    assert_equal 0, JSON.parse(response.body).dig("home", "counts", "ungraded")

    as_user(@student) do
      patch "/api/v1/progress", params: { content_block_id: reading_block.id, status: "completed", cohort_id: alternate.id }, headers: auth_headers
    end
    assert_response :success
    as_user(@student) do
      post "/api/v1/submissions", params: { content_block_id: exercise.id, text: "Parallel course work", cohort_id: alternate.id }, headers: auth_headers
    end
    assert_response :created
    assert_equal [ first_enrollment.id, alternate_enrollment.id ].sort,
      Progress.where(user: @student, content_block: reading_block).pluck(:enrollment_id).sort
    assert_equal [ first_enrollment.id, alternate_enrollment.id ].sort,
      Submission.where(user: @student, content_block: exercise).pluck(:enrollment_id).sort

    as_user(@admin) do
      get "/api/v1/cohorts/#{alternate.id}/modules/#{curriculum_module.id}/submissions", headers: auth_headers
    end
    assert_equal [ "Parallel course work" ], JSON.parse(response.body).fetch("submissions").map { |submission| submission.fetch("text") }
    as_user(@student) { get "/api/v1/cohorts/#{alternate.id}/home", headers: auth_headers }
    assert_equal 100.0, JSON.parse(response.body).dig("home", "own_progress_percentage")
  end

  test "opening one cohort home records only that membership as joined" do
    first_enrollment = @first.enrollments.find_by!(user: @student)
    second_enrollment = @second.enrollments.find_by!(user: @student)
    assert_nil first_enrollment.joined_at
    assert_nil second_enrollment.joined_at

    as_user(@student) { get "/api/v1/cohorts/#{@first.id}/home", headers: auth_headers }
    assert_response :success
    joined_at = first_enrollment.reload.joined_at
    assert joined_at
    assert_nil second_enrollment.reload.joined_at

    as_user(@student) { get "/api/v1/cohorts/#{@first.id}/home", headers: auth_headers }
    assert_equal joined_at, first_enrollment.reload.joined_at
    as_user(@admin) { get "/api/v1/cohorts/#{@first.id}/home", headers: auth_headers }
    assert_equal 1, JSON.parse(response.body).dig("home", "counts", "joined")
    assert_equal 1, JSON.parse(response.body).dig("home", "counts", "invited")
  end

  private

  def cohort_ids
    JSON.parse(response.body).fetch("cohorts").map { |cohort| cohort.fetch("id") }
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
