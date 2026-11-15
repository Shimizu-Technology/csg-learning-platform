require "test_helper"

# L-0.5: peek cards read GET /api/v1/records/:type/:id/summary. Staff see staff
# facts for records in cohorts they can access; students only peek at lessons
# they can open and see only their own progress. Anything else is a 404.
class RecordSummariesTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Peek curriculum")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Make decisions", position: 0, release_day: 0)
    @video = @lesson.content_blocks.create!(block_type: :video, title: "Watch", position: 0, s3_video_key: "content_videos/11111111-1111-4111-8111-111111111111/a.mp4")
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, title: "Ticket prices", position: 1, submission_type: :text_submission)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current - 14, end_date: Date.current + 80, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current, status: :active)
    @admin = person("admin", :admin)
    @instructor = person("instructor", :instructor)
    @outsider = person("outsider", :instructor)
    @student = person("student", :student)
    @classmate = person("classmate", :student)
    @stranger = person("stranger", :student)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.cohort_instructor_assignments.create!(user: @outsider)
    @enrollment = enroll(@student, @cohort)
    @classmate_enrollment = enroll(@classmate, @cohort)
    @stranger_enrollment = enroll(@stranger, @other_cohort)
  end

  test "staff see a learner's progress, waiting work, open help and status" do
    Progress.create!(enrollment: @enrollment, user: @student, content_block: @exercise, status: :completed, completed_at: 1.hour.ago)
    submit(@enrollment)
    help(@student, @cohort)

    summary = peek(@instructor, "student", @student.id)
    assert_response :success
    assert_equal [ "student", @student.id, "Source Student", @cohort.id, "Cohort 3" ], summary.values_at("type", "id", "title", "cohort_id", "subtitle")
    facts = facts_of(summary)
    assert_equal "1 / 1", facts.dig("progress", "value"), "Counts completion steps (the exercise), not the video"
    assert_equal 1, facts.dig("waiting_review", "value")
    assert_equal 1, facts.dig("open_help", "value")
    assert_equal "Needs help", facts.dig("status", "value")
    assert facts.dig("status", "attention")
    refute summary.key?("email"), "Peek cards never carry an email"
    assert_equal "private, no-store", response.headers["Cache-Control"]

    assert_equal "On track", facts_of(peek(@admin, "student", @classmate.id)).dig("status", "value")
  end

  test "staff only peek at learners in cohorts they can access" do
    peek(@instructor, "student", @stranger.id)
    assert_response :not_found
    peek(@instructor, "student", @stranger.id, cohort_id: @other_cohort.id)
    assert_response :not_found
    peek(@instructor, "student", @student.id, cohort_id: @other_cohort.id)
    assert_response :not_found
    peek(@instructor, "student", @instructor.id)
    assert_response :not_found, "Staff accounts have no learner summary"

    assert_equal @other_cohort.id, peek(@outsider, "student", @stranger.id)["cohort_id"]
    assert_equal @other_cohort.id, peek(@admin, "student", @stranger.id, cohort_id: @other_cohort.id)["cohort_id"]
  end

  test "students never peek at learners or cohorts, including their own" do
    [ [ "student", @classmate.id ], [ "student", @stranger.id ], [ "student", @student.id ], [ "cohort", @cohort.id ], [ "cohort", @other_cohort.id ] ].each do |type, id|
      peek(@student, type, id)
      assert_response :not_found, "#{type} #{id}"
      assert_equal({ "error" => "Not found" }, response.parsed_body)
    end
  end

  test "students peek at lessons they can open and see only their own work" do
    submit(@enrollment, grade: :R)
    submit(@classmate_enrollment)
    help(@classmate, @cohort)

    summary = peek(@student, "lesson", @lesson.id)
    assert_response :success
    assert_equal [ "lesson", "Make decisions", "Week 1 · Peek curriculum", @cohort.id ], summary.values_at("type", "title", "subtitle", "cohort_id")
    facts = facts_of(summary)
    assert_equal %w[lesson_type progress review required], facts.keys
    assert_equal "Redo requested", facts.dig("review", "value")
    assert_equal "0 / 1", facts.dig("progress", "value")
    refute facts.key?("waiting_review"), "A learner never sees class-wide counts"
    refute facts.key?("open_help")
  end

  test "students can't peek at lessons they can't open" do
    later = Lesson.create!(curriculum_module: @module, title: "Not yet", position: 1, release_day: 60)
    other_curriculum = Curriculum.create!(name: "Elsewhere")
    elsewhere = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: other_curriculum, name: "Away", position: 0), title: "Away", position: 0, release_day: 0)

    peek(@student, "lesson", later.id)
    assert_response :not_found
    peek(@student, "lesson", elsewhere.id)
    assert_response :not_found
    peek(@student, "lesson", @lesson.id, cohort_id: @other_cohort.id)
    assert_response :not_found
    peek(@student, "lesson", 0)
    assert_response :not_found
  end

  test "staff lesson facts count only cohorts the viewer can access" do
    submit(@enrollment)
    submit(@classmate_enrollment, grade: :R)
    submit(@stranger_enrollment)
    help(@student, @cohort, context_type: :exercise, context_id: @exercise.id)
    help(@stranger, @other_cohort)
    [ @video, @exercise ].each { |block| Progress.create!(enrollment: @enrollment, user: @student, content_block: block, status: :completed, completed_at: 1.hour.ago) }

    facts = facts_of(peek(@instructor, "lesson", @lesson.id))
    assert_response :success
    assert_equal [ 1, 1, 1, "1 / 2" ], facts.values_at("waiting_review", "redo_open", "open_help", "finished").map { |fact| fact["value"] }

    admin = facts_of(peek(@admin, "lesson", @lesson.id))
    assert_equal [ 2, 1, 2, "1 / 3" ], admin.values_at("waiting_review", "redo_open", "open_help", "finished").map { |fact| fact["value"] }

    scoped = peek(@admin, "lesson", @lesson.id, cohort_id: @other_cohort.id)
    assert_equal [ @other_cohort.id, "Cohort 4" ], scoped.values_at("cohort_id", "cohort_name")
    assert_equal [ 1, 0, 1 ], facts_of(scoped).values_at("waiting_review", "redo_open", "open_help").map { |fact| fact["value"] }

    peek(@instructor, "lesson", @lesson.id, cohort_id: @other_cohort.id)
    assert_response :not_found
  end

  test "staff see cohort students, attention, grading and the next session" do
    submit(@enrollment)
    OfficeHour.create!(cohort: @cohort, created_by: @instructor, title: "Saturday class", starts_at: 2.days.from_now, ends_at: 2.days.from_now + 2.hours, timezone: "Pacific/Guam", meeting_url: "https://meet.example.com/class")

    summary = peek(@instructor, "cohort", @cohort.id)
    assert_response :success
    assert_equal [ "cohort", "Cohort 3" ], summary.values_at("type", "title")
    assert_match(/Peek curriculum · Active · Week 3 of \d+/, summary["subtitle"])
    facts = facts_of(summary)
    assert_equal [ 2, 1, 1 ], facts.values_at("students", "needs_attention", "waiting_review").map { |fact| fact["value"] }
    assert_equal [ "time", "Saturday class" ], facts["next_event"].values_at("kind", "label")

    peek(@instructor, "cohort", @other_cohort.id)
    assert_response :not_found
    assert_equal "None scheduled", facts_of(peek(@admin, "cohort", @other_cohort.id)).dig("next_event", "value")
  end

  test "a lesson the viewer can't open is refused before its steps or curriculum load" do
    other_curriculum = Curriculum.create!(name: "Elsewhere")
    elsewhere = Lesson.create!(curriculum_module: CurriculumModule.create!(curriculum: other_curriculum, name: "Away", position: 0), title: "Away", position: 0, release_day: 0)
    elsewhere.content_blocks.create!(block_type: :exercise, title: "Hidden", position: 0, submission_type: :text_submission)

    missing = summary_queries(@student, "lesson", 999_999)
    denied = summary_queries(@student, "lesson", elsewhere.id)
    staff_denied = summary_queries(@instructor, "lesson", @lesson.id, cohort_id: @other_cohort.id)

    [ missing, denied, staff_denied ].each do |queries|
      assert_empty queries.grep(/FROM "content_blocks"/), queries.join("\n")
      assert_empty queries.grep(/FROM "curriculums"/), queries.join("\n")
    end
    assert_operator denied.size, :<=, missing.size + 1, "Denied: #{denied.join("\n")}\nMissing: #{missing.join("\n")}"

    granted = summary_queries(@student, "lesson", @lesson.id)
    assert granted.grep(/FROM "content_blocks"/).any?, "Builds the summary once allowed"
  end

  test "unknown types, malformed ids and missing records are 404, and sign-in is required" do
    [ [ "submission", @lesson.id ], [ "user", @student.id ], [ "lesson", "abc" ], [ "lesson", 999_999 ], [ "cohort", 999_999 ], [ "student", 999_999 ] ].each do |type, id|
      peek(@admin, type, id)
      assert_response :not_found, "#{type} #{id}"
    end
    peek(@admin, "lesson", @lesson.id, cohort_id: "1 OR 1=1")
    assert_response :not_found

    get "/api/v1/records/lesson/#{@lesson.id}/summary"
    assert_response :unauthorized
  end

  private

  def person(name, role)
    User.create!(clerk_id: "peek_#{name}", email: "peek-#{name}@example.com", first_name: "Source", last_name: name.capitalize, role: role)
  end

  def enroll(user, cohort)
    Enrollment.create!(user: user, cohort: cohort, status: :active, joined_at: 1.day.ago).tap do |enrollment|
      ModuleAssignment.create!(enrollment: enrollment, curriculum_module: @module, unlocked: true)
    end
  end

  def submit(enrollment, grade: nil)
    Submission.create!(user: enrollment.user, enrollment: enrollment, content_block: @exercise, submission_type: :text_submission,
      text: "Synthetic answer", grade: grade, graded_at: grade && Time.current)
  end

  def help(student, cohort, context_type: :lesson, context_id: @lesson.id)
    HelpRequest.create!(student: student, cohort: cohort, category: :concept, context_type: context_type, context_id: context_id,
      context_label: "Make decisions", context_path: "/lessons/#{@lesson.id}", message: "Synthetic question")
  end

  # SQL RecordSummary runs for one viewer, after the viewer's own row is loaded.
  def summary_queries(user, type, id, **params)
    user.reload
    queries = []
    callback = lambda do |*, payload|
      queries << payload[:sql] unless payload[:name] == "SCHEMA" || payload[:sql].match?(/\A\s*(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)/)
    end
    result = ActiveSupport::Notifications.subscribed(callback, "sql.active_record") do
      RecordSummary.for(viewer: user, type: type, id: id, **params)
    end
    assert_nil result if queries.none? { |sql| sql.include?("content_blocks") }
    queries
  end

  def facts_of(summary)
    summary.fetch("facts").index_by { |fact| fact["key"] }
  end

  def peek(user, type, id, **params)
    as_user(user) { get "/api/v1/records/#{type}/#{id}/summary", params: params, headers: auth_headers }
    response.parsed_body["summary"]
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
