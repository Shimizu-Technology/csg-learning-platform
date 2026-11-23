require "test_helper"

class LessonVideoSectionsTest < ActionDispatch::IntegrationTest
  setup do
    curriculum = Curriculum.create!(name: "Synthetic recording curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Test cohort", start_date: Date.current, status: :active)
    @mod = curriculum.modules.create!(name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = @mod.lessons.create!(title: "Synthetic lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :recording, position: 0, title: "Synthetic recording",
      s3_video_key: "content_videos/11111111-1111-4111-8111-111111111111/intro.mp4", s3_video_duration_seconds: 60,
      metadata: { video_segments: segments })
    @student = User.create!(clerk_id: "test_recording_student", email: "recording-student@example.com", first_name: "Test", last_name: "Learner", role: :student)
    @enrollment = enroll(@cohort)
    @source = LessonVideoSections.new(@block).sources.fetch("default")
  end

  test "section checks persist independently and old pings and retries keep earned credit" do
    assert_equal @source, lesson_block.dig("video_progress_sources", "default")
    optional = report(ranges: [ "30:33" ], position: 33, total: 3)
    assert_equal({ @source => [ "30:33" ] }, optional.fetch("completed_video_sections"))
    refute optional.fetch("completed")

    first = report(ranges: [ "5:8", "5:7" ], position: 8, total: 6)
    assert_equal [ "30:33", "5:8" ], first.fetch("completed_video_sections").fetch(@source)
    refute first.fetch("completed")
    assert_equal first.fetch("completed_video_sections"), lesson_block.dig("progress", "completed_video_sections")
    final = report(ranges: [ "15:18" ], position: 18, total: 9)
    assert_equal [ "30:33", "5:8", "15:18" ], final.fetch("completed_video_sections").fetch(@source)
    assert final.fetch("completed")
    completed_at = @enrollment.progresses.find_by!(content_block: @block).completed_at
    2.times do
      resent = report(ranges: [ "15:18", "15:18" ], position: 16, total: 1)
      assert resent.fetch("completed")
      assert_equal 9, resent.fetch("total_watched")
      assert_equal final.fetch("completed_video_sections"), resent.fetch("completed_video_sections")
    end
    assert_equal completed_at, @enrollment.progresses.find_by!(content_block: @block).completed_at
    assert_equal final.fetch("completed_video_sections"), lesson_block.dig("progress", "completed_video_sections")
    assert_equal 1, ActivityEvent.where(actor: @student, record_type: "ContentBlock", record_id: @block.id, event_type: "video_completed").count
  end

  test "position alone, malformed section and optional playback cannot complete Core" do
    jump = report(ranges: [ "5:8", "15:18" ], position: 60, total: 0)
    assert_empty jump.fetch("completed_video_sections")
    refute jump.fetch("completed")
    malformed = report(ranges: [ "5:8:forged", "5:7", { start_seconds: 15, end_seconds: 18 } ], position: 60, total: 10)
    assert_empty malformed.fetch("completed_video_sections")
    no_watch_reported = report(ranges: [ "5:8" ], position: 60, total: 0)
    assert_empty no_watch_reported.fetch("completed_video_sections")
    travel 30.seconds
    optional = report(ranges: [ "30:33" ], position: 59, total: 59)
    assert_equal 59, optional.fetch("total_watched")
    refute optional.fetch("completed")
  end

  test "legacy pings retain the 90 percent path on Core and modern pings retain it without Core" do
    report(source: nil, total: 1)
    travel 30.seconds
    assert report(source: nil, total: 54).fetch("completed")
    @block.update!(metadata: { video_segments: segments.map { |segment| segment.merge(required: false) } })
    assert report(total: 1).fetch("completed")
    @enrollment.progresses.delete_all
    refute report(total: 1, ranges: []).fetch("completed")
    travel 30.seconds
    assert report(total: 54, ranges: []).fetch("completed")
  end

  test "range changes invalidate only the edited range and retain completed status" do
    assert report(ranges: [ "5:8", "15:18" ], total: 6).fetch("completed")
    @block.update!(metadata: { video_segments: [ segments[0].merge(label: "Renamed"), segments[1].merge(end_seconds: 19), segments[2] ] })
    stale = report(ranges: [ "15:18" ], total: 10)
    assert_equal({ @source => [ "5:8" ] }, stale.fetch("completed_video_sections"))
    assert stale.fetch("completed")
    assert_equal [ "15:18" ], stale.fetch("section_rejected_ranges")
    assert_equal({ @source => [ "5:8", "15:19" ] }, report(ranges: [ "15:19" ], total: 10).fetch("completed_video_sections"))
  end

  test "versions keep separate ranges, swapping defaults keeps the file's credit, and replacement resets" do
    alternate = "content_videos/22222222-2222-4222-8222-222222222222/alternate.mp4"
    @block.update!(metadata: @block.metadata.merge("video_versions" => [
      { "id" => "original", "label" => "Original", "s3_video_key" => @block.s3_video_key },
      { "id" => "alternate", "label" => "Alternate", "s3_video_key" => alternate }
    ]))
    other = lesson_block.dig("video_progress_sources", "versions", "alternate")
    refute_equal @source, other
    refute report(ranges: [ "5:8" ], total: 3).fetch("completed")
    refute report(source: other, ranges: [ "15:18" ], total: 6).fetch("completed")
    @block.update!(metadata: @block.metadata.merge("video_versions" => @block.video_versions.reverse))
    assert_equal other, lesson_block.dig("video_progress_sources", "default")
    assert_equal({ @source => [ "5:8" ], other => [ "15:18" ] }, lesson_block.dig("progress", "completed_video_sections"))
    assert report(source: other, ranges: [ "5:8" ], total: 9).fetch("completed")

    @block.update!(metadata: @block.metadata.except("video_versions"))
    @block.update!(s3_video_key: alternate, metadata: { video_segments: segments }, confirm_watch_reset: true)
    report(source: @source, ranges: [ "5:8" ], total: 3, expected: :conflict)
    progress = @enrollment.progresses.find_by!(content_block: @block)
    assert progress.not_started?
    assert_equal 0, progress.video_total_watched
    assert_empty progress.completed_video_sections
  end

  test "active class writes are scoped to the chosen enrollment and unavailable lessons reject section writes" do
    other_cohort = Cohort.create!(curriculum: @cohort.curriculum, name: "Other test cohort", start_date: Date.current, status: :active)
    other = enroll(other_cohort)
    report(ranges: [ "5:8" ], total: 3)
    assert_nil lesson_block(cohort: other_cohort)["progress"]
    report(cohort: other_cohort, ranges: [ "15:18" ], total: 3)
    assert_equal({ @source => [ "5:8" ] }, @enrollment.progresses.first.completed_video_sections)
    assert_equal({ @source => [ "15:18" ] }, other.progresses.first.completed_video_sections)

    LessonAssignment.create!(enrollment: other, lesson: @lesson, unlocked: false, unlock_date_override: 7.days.from_now.to_date)
    report(cohort: other_cohort, ranges: [ "5:8" ], total: 9, expected: :forbidden)
    other.update!(status: :paused)
    report(cohort: other_cohort, ranges: [ "5:8" ], total: 9, expected: :forbidden)
    assert_equal({ @source => [ "15:18" ] }, other.progresses.first.completed_video_sections)
  end

  test "linked recordings use their own source and can complete the Core path" do
    @block.update!(s3_video_key: nil, video_url: "https://www.youtube.com/watch?v=abcdef12345")
    linked = lesson_block.dig("video_progress_sources", "default")
    refute_equal @source, linked
    report(ranges: [ "5:8" ], total: 3, expected: :conflict)
    result = report(source: linked, ranges: [ "5:8", "15:18" ], total: 6)
    assert result.fetch("completed")
    assert_equal({ linked => [ "5:8", "15:18" ] }, result.fetch("completed_video_sections"))
  end

  test "a late first save keeps the watch cap and tells the client when the range can be retried" do
    freeze_time
    @block.update!(metadata: { video_segments: [ { label: "Long Core", start_seconds: 0, end_seconds: 55, required: true } ] })
    capped = report(ranges: [ "0:55" ], total: 54, position: 55)
    assert_equal 20, capped.fetch("total_watched")
    assert_equal 14, capped.fetch("section_retry_after_seconds")
    assert_empty capped.fetch("completed_video_sections")
    refute report(ranges: [ "0:55" ], total: 54, position: 55).fetch("completed")
    travel 14.seconds
    accepted = report(ranges: [ "0:55" ], total: 54, position: 55)
    assert accepted.fetch("completed")
    assert_equal [ "0:55" ], accepted.fetch("completed_video_sections").fetch(@source)
    refute accepted.key?("section_retry_after_seconds")
  end

  test "anchoring starts the credit clock and the first hosted duration stays authoritative" do
    @block.update!(s3_video_duration_seconds: nil,
      metadata: { video_segments: [ { label: "Long Core", start_seconds: 0, end_seconds: 55, required: true } ] })
    assert_equal 0, report(total: 0, position: 0).fetch("total_watched")
    assert_equal 60, @block.reload.s3_video_duration_seconds
    travel 27.seconds
    saved = report(ranges: [ "0:55" ], total: 54, position: 55, duration: 90)
    assert saved.fetch("completed")
    assert_equal 60, saved.fetch("duration")
    assert_equal 60, @block.reload.s3_video_duration_seconds
  end

  test "current linked clients cannot manually complete Core but legacy clients and no-Core still can" do
    @block.update!(s3_video_key: nil, video_url: "https://youtube.com/shorts/abcdef12345")
    linked = lesson_block.dig("video_progress_sources", "default")
    assert linked.present?
    as_user(@student) do
      payload = { content_block_id: @block.id, cohort_id: @cohort.id, status: "completed" }
      patch "/api/v1/progress", params: payload.merge(video_source: linked), headers: auth_headers, as: :json
      assert_response :unprocessable_entity
      assert_empty @enrollment.progresses
      patch "/api/v1/progress", params: payload.merge(video_source: @source), headers: auth_headers, as: :json
      assert_response :conflict
      assert_equal "video_source_changed", response.parsed_body["code"]
      patch "/api/v1/progress", params: payload, headers: auth_headers, as: :json
      assert_response :success
      @block.update!(metadata: {})
      patch "/api/v1/progress", params: payload.merge(video_source: linked), headers: auth_headers, as: :json
      assert_response :success
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) do |_token|
      { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    end
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end

  def enroll(cohort)
    enrollment = Enrollment.create!(user: @student, cohort: cohort, status: :active)
    ModuleAssignment.find_or_initialize_by(enrollment: enrollment, curriculum_module: @mod).update!(unlocked: true)
    enrollment
  end

  def segments
    [
      { label: "First Core", start_seconds: 5, end_seconds: 8, required: true },
      { label: "Second Core", start_seconds: 15, end_seconds: 18, required: true },
      { label: "Optional", start_seconds: 30, end_seconds: 33, required: false }
    ]
  end

  def report(source: @source, ranges: nil, position: 33, total:, duration: 60, cohort: @cohort, expected: :success)
    payload = { cohort_id: cohort.id, last_position_seconds: position, total_watched_seconds: total, duration_seconds: duration, watch_credit_version: 2 }
    payload[:video_source] = source if source
    payload[:completed_section_ranges] = ranges if ranges
    as_user(@student) do
      patch "/api/v1/content_blocks/#{@block.id}/video_progress", params: payload, headers: auth_headers, as: :json
    end
    assert_response expected
    response.parsed_body["video_progress"]
  end

  def lesson_block(cohort: @cohort)
    as_user(@student) { get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: cohort.id }, headers: auth_headers }
    assert_response :success
    response.parsed_body.fetch("lesson").fetch("content_blocks").find { |row| row.fetch("id") == @block.id }
  end
end
