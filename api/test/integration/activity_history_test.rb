require "test_helper"

class ActivityHistoryTest < ActionDispatch::IntegrationTest
  setup do
    @issuer = "https://activity.clerk.test"
    @curriculum = Curriculum.create!(name: "Activity curriculum")
    mod = CurriculumModule.create!(curriculum: @curriculum, name: "Week one", position: 0)
    lesson = Lesson.create!(curriculum_module: mod, title: "Watch and submit", position: 0, release_day: 0)
    @video = lesson.content_blocks.create!(block_type: :video, position: 0, title: "Embedded lesson", video_url: "https://www.youtube.com/watch?v=abc123def45")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Alumni", start_date: Date.current, status: :active)
    @student = User.create!(clerk_id: "activity_student", email: "activity-student@example.com", role: :student)
    @other = User.create!(clerk_id: "activity_other", email: "activity-other@example.com", role: :student)
    @staff = User.create!(clerk_id: "activity_staff", email: "activity-staff@example.com", role: :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @staff)
    @admin = User.create!(clerk_id: "activity_admin", email: "activity-admin@example.com", role: :admin)
    @student.clerk_identities.create!(issuer: @issuer, clerk_user_id: @student.clerk_id)
    @student_enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @student_enrollment.module_assignments.create!(curriculum_module: mod, unlocked: true)
  end

  test "a Clerk session is logged once across refreshes and alternating sessions" do
    as_user(@student, sid: "session-one") { post "/api/v1/sessions", headers: auth_headers }
    assert_response :success
    first_sign_in_at = @student.reload.last_sign_in_at
    as_user(@student, sid: "session-two") { post "/api/v1/sessions", headers: auth_headers }
    as_user(@student, sid: "session-one") { post "/api/v1/sessions", headers: auth_headers }
    as_user(@student) { post "/api/v1/sessions", headers: auth_headers }

    assert_equal 2, @student.auth_sessions.count
    assert_equal 2, ActivityEvent.where(subject_user: @student, event_type: "account_signed_in").count
    assert @student.reload.last_sign_in_at >= first_sign_in_at
    refute_includes @student.auth_sessions.pluck(:session_digest), "session-one"
  end

  test "students see only their own history and staff can inspect an enrolled student" do
    event = ActivityEvent.record!(event_type: "account_signed_in", actor: @student, cohort: @cohort)
    as_user(@other) { get "/api/v1/activity_events", params: { user_id: @student.id }, headers: auth_headers }
    assert_response :forbidden

    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id }, headers: auth_headers }
    assert_response :success
    assert_equal event.id, JSON.parse(response.body).fetch("activity_events").first.fetch("id")

    unrelated = Cohort.create!(curriculum: @curriculum, name: "Unrelated", start_date: Date.current, status: :active)
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id, cohort_id: unrelated.id }, headers: auth_headers }
    assert_response :not_found
  end

  test "instructors cannot inspect administrator history, while administrators can" do
    event = ActivityEvent.record!(event_type: "account_signed_in", actor: @admin)
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @admin.id }, headers: auth_headers }
    assert_response :forbidden

    as_user(@admin) { get "/api/v1/activity_events", params: { user_id: @admin.id }, headers: auth_headers }
    assert_response :success
    assert_equal event.id, JSON.parse(response.body).fetch("activity_events").first.fetch("id")
  end

  test "activity history filters and paginates without exposing authored text" do
    older = ActivityEvent.record!(event_type: "account_signed_in", actor: @student)
    newer = ActivityEvent.record!(event_type: "video_started", actor: @student, cohort: @cohort, record: @video, evidence: "player_reported")

    as_user(@student) { get "/api/v1/activity_events", params: { limit: 1 }, headers: auth_headers }
    assert_response :success
    first = JSON.parse(response.body)
    assert_equal newer.id, first.fetch("activity_events").first.fetch("id")
    assert_equal newer.id, first.fetch("next_before_id")
    refute first.fetch("activity_events").first.key?("video_url")

    as_user(@student) { get "/api/v1/activity_events", params: { before_id: newer.id, category: "account" }, headers: auth_headers }
    assert_response :success
    assert_equal older.id, JSON.parse(response.body).fetch("activity_events").first.fetch("id")
  end

  test "embedded player progress saves and creates bounded player reported history" do
    Progress.create!(user: @student, content_block: @video, status: :not_started)
    as_user(@student) do
      patch "/api/v1/content_blocks/#{@video.id}/video_progress", params: { last_position_seconds: 12, total_watched_seconds: 12, duration_seconds: 100 }, headers: auth_headers, as: :json
    end
    assert_response :success
    as_user(@student) do
      patch "/api/v1/content_blocks/#{@video.id}/video_progress", params: { last_position_seconds: 50, total_watched_seconds: 50, duration_seconds: 100 }, headers: auth_headers, as: :json
      patch "/api/v1/content_blocks/#{@video.id}/video_progress", params: { last_position_seconds: 95, total_watched_seconds: 95, duration_seconds: 100 }, headers: auth_headers, as: :json
    end
    assert_response :success
    events = ActivityEvent.where(subject_user: @student, record_type: "ContentBlock", record_id: @video.id).order(:id)
    assert_equal %w[video_started video_completed], events.pluck(:event_type)
    assert_equal [ "player_reported" ], events.pluck(:evidence).uniq
    assert_nil @video.reload.s3_video_duration_seconds
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user, sid: nil)
    payload = { "sub" => user.clerk_id, "iss" => @issuer, "email" => user.email }
    payload["sid"] = sid if sid
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
