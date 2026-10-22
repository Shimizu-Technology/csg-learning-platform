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

  test "cohort scoped activity paginates only the requested enrollment sharing a curriculum" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Second enrollment", start_date: Date.current, status: :active)
    Enrollment.create!(user: @student, cohort: other_cohort)
    first = ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: @cohort, record: @video)
    ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: other_cohort, record: @video)
    second = ActivityEvent.record!(event_type: "video_started", actor: @student, cohort: @cohort, record: @video)
    ActivityEvent.record!(event_type: "account_signed_in", actor: @student)
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id, cohort_id: @cohort.id, category: "learning", limit: 1 }, headers: auth_headers }
    assert_response :success
    body = JSON.parse(response.body)
    assert_equal [ second.id ], body.fetch("activity_events").map { |row| row.fetch("id") }
    assert_equal second.id, body.fetch("next_before_id")
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id, cohort_id: @cohort.id, before_id: second.id }, headers: auth_headers }
    assert_equal [ first.id ], JSON.parse(response.body).fetch("activity_events").map { |row| row.fetch("id") }
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id, cohort_id: other_cohort.id }, headers: auth_headers }
    assert_response :forbidden
  end

  test "destinations resolve exact authorized records and never invent a sign in or deleted target" do
    submission = Submission.create!(user: @student, enrollment: @student_enrollment, content_block: @video, text: "work")
    recording = Recording.create!(cohort: @cohort, title: "Class", source_kind: "youtube", source_url: "https://youtu.be/abc123def45", status: :published)
    events = [
      ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort, record: submission),
      ActivityEvent.record!(event_type: "video_started", actor: @student, cohort: @cohort, record: @video),
      ActivityEvent.record!(event_type: "recording_started", actor: @student, cohort: @cohort, record: recording),
      ActivityEvent.record!(event_type: "account_signed_in", actor: @student)
    ]
    as_user(@admin) { get "/api/v1/activity_events", params: { user_id: @student.id }, headers: auth_headers }
    rows = JSON.parse(response.body).fetch("activity_events").index_by { |row| row.fetch("id") }
    assert_equal({ "kind" => "submission", "submission_id" => submission.id, "cohort_id" => @cohort.id, "student_id" => @student.id }, rows.fetch(events[0].id).fetch("destination"))
    assert_equal @video.lesson_id, rows.fetch(events[1].id).fetch("destination").fetch("lesson_id")
    assert_equal @video.id, rows.fetch(events[1].id).fetch("destination").fetch("content_block_id")
    assert_equal recording.id, rows.fetch(events[2].id).fetch("destination").fetch("recording_id")
    assert_equal LearningDestination.lesson(lesson_id: @video.lesson_id, cohort_id: @cohort.id, block_id: @video.id), rows.fetch(events[1].id).fetch("destination").fetch("destination_path")
    assert_equal LearningDestination.recording(recording_id: recording.id, cohort_id: @cohort.id), rows.fetch(events[2].id).fetch("destination").fetch("destination_path")
    assert_nil rows.fetch(events[3].id).fetch("destination")

    as_user(@student) { get "/api/v1/activity_events", headers: auth_headers }
    own_rows = JSON.parse(response.body).fetch("activity_events").index_by { |row| row.fetch("id") }
    assert_equal "lesson", own_rows.fetch(events[0].id).fetch("destination").fetch("kind")
    assert_equal @video.id, own_rows.fetch(events[0].id).fetch("destination").fetch("content_block_id")
    @student_enrollment.update!(access_expires_at: 1.second.ago)
    as_user(@student) { get "/api/v1/activity_events", headers: auth_headers }
    assert JSON.parse(response.body).fetch("activity_events").all? { |row| row["destination"].nil? }
    assert_equal 4, JSON.parse(response.body).fetch("activity_events").length, "personal history must remain readable"

    recording.destroy!
    as_user(@admin) { get "/api/v1/activity_events", params: { user_id: @student.id }, headers: auth_headers }
    assert_nil JSON.parse(response.body).fetch("activity_events").find { |row| row["id"] == events[2].id }.fetch("destination")
  end

  test "mismatched submission cohorts and unavailable learning content have no destination" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Second enrollment", start_date: Date.current, status: :active)
    other_enrollment = Enrollment.create!(user: @student, cohort: other_cohort)
    submission = Submission.create!(user: @student, enrollment: other_enrollment, content_block: @video, text: "other work")
    ActivityEvent.record!(event_type: "submission_created", actor: @student, cohort: @cohort, record: submission)
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id }, headers: auth_headers }
    assert_nil JSON.parse(response.body).fetch("activity_events").sole.fetch("destination")
    ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: @cohort, record: @video)
    @video.lesson.update!(archived_at: Time.current)
    as_user(@student) { get "/api/v1/activity_events", headers: auth_headers }
    assert JSON.parse(response.body).fetch("activity_events").all? { |row| row["destination"].nil? }
  end

  test "staff can follow recording activity into an assigned completed cohort library" do
    @cohort.update!(status: :completed)
    recording = Recording.create!(cohort: @cohort, title: "Past class", source_kind: "youtube", source_url: "https://youtu.be/abc123def45", status: :published)
    ActivityEvent.record!(event_type: "recording_started", actor: @student, cohort: @cohort, record: recording)
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id, cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    destination = JSON.parse(response.body).fetch("activity_events").sole.fetch("destination")
    as_user(@staff) { get "/api/v1/recordings", params: { cohort_id: destination.fetch("cohort_id") }, headers: auth_headers }
    assert_response :success
    assert_equal recording.id, JSON.parse(response.body).fetch("items").sole.fetch("id")
    @cohort.cohort_instructor_assignments.destroy_all
    as_user(@staff) { get "/api/v1/recordings", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :forbidden
  end

  test "legacy lesson recording activity opens its exact lesson block" do
    @video.update!(block_type: :recording)
    ActivityEvent.record!(event_type: "video_started", actor: @student, cohort: @cohort, record: @video)
    as_user(@staff) { get "/api/v1/activity_events", params: { user_id: @student.id, cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    assert_equal({ "kind" => "lesson", "cohort_id" => @cohort.id, "student_id" => @student.id,
      "lesson_id" => @video.lesson_id, "content_block_id" => @video.id,
      "destination_path" => LearningDestination.lesson(lesson_id: @video.lesson_id, cohort_id: @cohort.id, block_id: @video.id) }, JSON.parse(response.body).fetch("activity_events").sole.fetch("destination"))
  end

  test "assignment query count stays bounded as distinct activity records grow across enrollments" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Second course", start_date: Date.current, status: :active)
    other_enrollment = Enrollment.create!(user: @student, cohort: other_cohort)
    @student_enrollment.module_assignments.update_all(unlocked: false)
    [ [ @cohort, @student_enrollment ], [ other_cohort, other_enrollment ] ].each do |cohort, enrollment|
      enrollment.lesson_assignments.create!(lesson: @video.lesson, unlocked: true)
      ActivityEvent.record!(event_type: "video_started", actor: @student, cohort: cohort, record: @video)
    end
    baseline = assignment_query_count
    8.times do |index|
      lesson = Lesson.create!(curriculum_module: @video.lesson.curriculum_module, title: "Extra lesson #{index}", position: index + 1, release_day: 0)
      block = lesson.content_blocks.create!(block_type: :text, position: 0, title: "Step #{index}")
      other_enrollment.lesson_assignments.create!(lesson: lesson, unlocked: true)
      [ @cohort, other_cohort ].each do |cohort|
        ActivityEvent.record!(event_type: "checkpoint_completed", actor: @student, cohort: cohort, record: block)
      end
    end
    expanded = assignment_query_count
    assert_equal 18, JSON.parse(response.body).fetch("activity_events").length
    assert JSON.parse(response.body).fetch("activity_events").all? { |row| row["destination"].present? }
    assert_operator expanded, :<=, baseline, "assignment SELECTs grew from #{baseline} to #{expanded}"
    assert_operator expanded, :<=, 3, "load enrollment assignments once, not per event"
  end

  private

  def assignment_query_count
    count = 0
    subscriber = lambda do |*args|
      payload = args.last
      count += 1 if payload[:sql].match?(/SELECT.*FROM "(?:module_assignments|lesson_assignments|cohort_module_schedules)"/m)
    end
    ActiveRecord::Base.uncached do
      ActiveSupport::Notifications.subscribed(subscriber, "sql.active_record") do
        as_user(@student) { get "/api/v1/activity_events", headers: auth_headers }
      end
    end
    assert_response :success
    count
  end

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
