require "test_helper"
require_relative "../support/query_counter"

class LessonRecordingsTest < ActionDispatch::IntegrationTest
  include QueryCounter

  setup do
    travel_to Time.zone.local(2026, 11, 20, 12)
    @curriculum = Curriculum.create!(name: "Shared class recordings")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript", position: 0)
    @lesson = create_lesson(@module, "Functions")
    @next_lesson = create_lesson(@module, "Arguments", release_day: 7)
    @cohort = create_cohort("Cohort 3")
    @other_cohort = create_cohort("Shared curriculum cohort")
    @instructor = person("Instructor", :instructor)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @student = person("Learner")
    @enrollment = enroll(@student, @cohort)
    @other_student = person("Other learner")
    enroll(@other_student, @other_cohort)
    @endpoint = "/api/v1/cohorts/#{@cohort.id}/recordings"
  end

  test "instructor creates dated attachments, replaces them in order, and clears them" do
    as_user(@instructor) do
      get "#{@endpoint}/lesson_options", headers: auth_headers
      assert_response :success
      assert_equal [ [ @lesson.id, "2026-11-02" ], [ @next_lesson.id, "2026-11-09" ] ],
        response.parsed_body.fetch("lessons").map { |choice| choice.values_at("id", "week_starts_on") }

      post @endpoint, params: {
        title: "Replay", source_url: "https://example.invalid/replay", duration_seconds: 125,
        lesson_ids: [ @next_lesson.id, @lesson.id ], publish_immediately: true
      }, headers: auth_headers, as: :json
      assert_response :created
      recording = response.parsed_body.fetch("recording")
      assert_equal [ 125, "2:05" ], recording.values_at("duration_seconds", "duration_display")
      assert_equal [ @next_lesson.id, @lesson.id ], recording.fetch("lessons").pluck("id")
      assert_equal [ [ @next_lesson.id, 0 ], [ @lesson.id, 1 ] ], Recording.find(recording.fetch("id")).lesson_recordings.pluck(:lesson_id, :position)

      patch "#{@endpoint}/#{recording.fetch('id')}", params: { lesson_ids: [ @lesson.id ], duration_seconds: 180 }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal [ @lesson.id ], response.parsed_body.dig("recording", "lessons").pluck("id")
      assert_equal "3:00", response.parsed_body.dig("recording", "duration_display")

      patch "#{@endpoint}/#{recording.fetch('id')}", params: { title: "Keep attachments" }, headers: auth_headers, as: :json
      assert_response :success
      assert_equal [ @lesson.id ], response.parsed_body.dig("recording", "lessons").pluck("id")

      patch "#{@endpoint}/#{recording.fetch('id')}", params: { lesson_ids: [] }, headers: auth_headers, as: :json
      assert_response :success
      assert_empty response.parsed_body.dig("recording", "lessons")
    end
  end

  test "foreign, archived, missing, and malformed lessons fail without partial writes" do
    archived = create_lesson(@module, "Archived")
    archived.update!(archived_at: Time.current)
    foreign_module = Curriculum.create!(name: "Different class").modules.create!(name: "Elsewhere", position: 0)
    foreign = create_lesson(foreign_module, "Different curriculum")
    recording = record("Keep current attachments")
    row = recording.lesson_recordings.create!(lesson: @lesson)
    assert_not recording.lesson_recordings.build(lesson: foreign).valid?

    as_user(@instructor) do
      get "#{@endpoint}/lesson_options", headers: auth_headers
      assert_response :success
      assert_equal [ @lesson.id, @next_lesson.id ], response.parsed_body.fetch("lessons").pluck("id")

      [ [ foreign.id ], [ archived.id ], [ Lesson.maximum(:id) + 1 ], [ "#{@lesson.id}.0" ], "bad", nil ].each do |ids|
        assert_no_difference("Recording.count") do
          post @endpoint, params: { title: "Invalid", source_url: "https://example.invalid/replay", lesson_ids: ids }, headers: auth_headers, as: :json
        end
        assert_response :unprocessable_entity
        patch "#{@endpoint}/#{recording.id}", params: { title: "Invalid", lesson_ids: ids }, headers: auth_headers, as: :json
        assert_response :unprocessable_entity
        assert_equal "Keep current attachments", recording.reload.title
        assert_equal [ row.id ], recording.lesson_recordings.reload.ids
      end
    end

    as_user(@student) do
      get "#{@endpoint}/lesson_options", headers: auth_headers
      assert_response :forbidden
    end
    as_user(person("Unassigned", :instructor)) do
      get "#{@endpoint}/lesson_options", headers: auth_headers
      assert_response :forbidden
    end
  end

  test "shared lessons only expose ordered recordings for the selected learner cohort" do
    earlier = record("Replay from Cohort 3", duration_seconds: 125)
    later = record("Second replay")
    draft = record("Private draft", status: :draft)
    other = record("Other cohort only", cohort: @other_cohort)
    [ later, earlier, draft, other ].each_with_index do |recording, position|
      recording.lesson_recordings.create!(lesson: @lesson, position: position)
    end
    WatchProgress.create!(user: @student, recording: earlier, duration_seconds: 125, total_watched_seconds: 50)

    recordings = lesson_json(@student, @cohort).fetch("attached_recordings")
    assert_equal [ later.id, earlier.id ], recordings.pluck("id")
    assert_equal [ "2:05", 40.0, false, "/recordings?cohort_id=#{@cohort.id}&recording=#{earlier.id}" ],
      recordings.last.values_at("duration_display", "progress_percentage", "completed", "path")
    assert_equal [ other.id ], lesson_json(@other_student, @other_cohort).fetch("attached_recordings").pluck("id")

    @cohort.update!(settings: { "features" => { "recordings" => false } })
    refute lesson_json(@student, @cohort).key?("attached_recordings")
    as_user(@student) do
      get "#{@endpoint}/#{earlier.id}", headers: auth_headers
      assert_response :forbidden
    end
  end

  test "paused learner keeps the older attached recording and cannot see later publications" do
    earlier = record("Already published")
    draft = record("Published after pause", status: :draft)
    [ earlier, draft ].each { |recording| recording.lesson_recordings.create!(lesson: @lesson) }
    travel 1.minute
    @enrollment.update!(status: :paused)
    travel 1.minute
    draft.update!(status: :published)
    assert_equal [ earlier.id ], lesson_json(@student, @cohort).fetch("attached_recordings").pluck("id")
  end

  test "reading a lesson and its recordings keeps a fixed query count" do
    request = -> { lesson_json(@student, @cohort).fetch("attached_recordings") }
    record("First").lesson_recordings.create!(lesson: @lesson)
    request.call # Warm the first-open and model caches before measuring.
    small = count_queries { assert_equal 1, request.call.size }
    5.times { |index| record("Replay #{index}").lesson_recordings.create!(lesson: @lesson) }
    large = count_queries { assert_equal 6, request.call.size }
    assert_equal small, large
  end

  test "playback only backfills a valid duration and subsequent reports use stored credit bounds" do
    recording = record("Unknown duration")
    as_user(@student) do
      [ nil, 0, -1, 86_401, 10.5, "50 seconds" ].each do |reported|
        watch(recording, reported)
        assert_nil recording.reload.duration_seconds
      end
      watch(recording, 86_400)
      assert_equal 86_400, recording.reload.duration_seconds
      watch(recording, 10)
      assert_equal 86_400, recording.reload.duration_seconds
      assert_equal 86_400, @student.watch_progresses.find_by!(recording: recording).duration_seconds
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_| { "sub" => user.clerk_id, "email" => user.email } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def create_lesson(mod, title, release_day: 0)
    mod.lessons.create!(title: title, release_day: release_day, position: 0)
  end

  def create_cohort(name)
    Cohort.create!(curriculum: @curriculum, name: name, start_date: Date.new(2026, 11, 2), status: :active)
  end

  def enroll(user, cohort)
    enrollment = cohort.enrollments.create!(user: user, status: :active)
    enrollment.module_assignments.find_or_initialize_by(curriculum_module: @module).update!(unlocked: true)
    enrollment
  end

  def person(name, role = :student)
    User.create!(clerk_id: "as7-#{name.parameterize}", email: "#{name.parameterize}@example.invalid", first_name: name, role: role)
  end

  def record(title, cohort: @cohort, status: :published, duration_seconds: nil)
    cohort.recordings.create!(title: title, source_kind: "external", source_url: "https://example.invalid/replay",
      status: status, duration_seconds: duration_seconds)
  end

  def lesson_json(user, cohort)
    as_user(user) { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: cohort.id }, headers: auth_headers }
    assert_response :success
    response.parsed_body.fetch("lesson")
  end

  def watch(recording, duration)
    patch "/api/v1/watch_progress", params: { recording_id: recording.id, duration_seconds: duration, last_position_seconds: 2, total_watched_seconds: 2 },
      headers: auth_headers, as: :json
    assert_response :success
  end
end
