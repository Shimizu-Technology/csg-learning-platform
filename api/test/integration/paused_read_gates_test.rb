require "test_helper"

# Reviewer repro for PR #302: after a pause, staff move
# the cohort start date (or the module date) later. The lesson page keeps the
# frozen library, but do the module page and the video stream agree?
class PausedReadGatesTest < ActionDispatch::IntegrationTest
  setup do
    @curriculum = Curriculum.create!(name: "Review paused gates")
    @mod = @curriculum.modules.create!(name: "Week 1", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = @mod.lessons.create!(title: "Day 1", position: 0, release_day: 0, created_at: 40.days.ago)
    @block = @lesson.content_blocks.create!(block_type: "video", position: 0, title: "Clip", s3_video_key: "content_videos/#{SecureRandom.uuid}/clip.mp4")
    @cohort = Cohort.create!(name: "Review cohort", curriculum: @curriculum, start_date: 30.days.ago.to_date, status: :active)
    @student = User.create!(clerk_id: "review_paused_gate", email: "review-paused-gate@example.invalid", role: :student, first_name: "R", last_name: "P")
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort)
    @assignment = @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: false)
    @original_configured = S3Service.method(:configured?)
    @original_signed = S3Service.method(:generate_presigned_url)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_url) { |*args, **kwargs| "https://signed.example/video" }
    @assignment.update_columns(created_at: 30.days.ago, updated_at: 30.days.ago, availability_changed_at: 30.days.ago)
  end

  teardown do
    S3Service.define_singleton_method(:configured?, @original_configured)
    S3Service.define_singleton_method(:generate_presigned_url, @original_signed)
  end

  test "old API pause without snapshot is captured before a postponement and stays frozen" do
    @enrollment.update_columns(status: Enrollment.statuses[:paused], paused_at: Time.current, paused_lesson_ids: nil, paused_library_cutoff_at: nil)
    @assignment.update!(unlock_date_override: 10.days.from_now.to_date)
    assert_equal [ @lesson.id ], @enrollment.reload.paused_lesson_ids
    assert_equal({ lesson: 200, module: 200, video: 200 }, reads)
  end

  test "first read lazily captures a pause written by the old API" do
    @enrollment.update_columns(status: Enrollment.statuses[:paused], paused_at: Time.current, paused_lesson_ids: nil, paused_library_cutoff_at: nil)
    assert_equal({ lesson: 200, module: 200, video: 200 }, reads)
    assert_equal [ @lesson.id ], @enrollment.reload.paused_lesson_ids
  end

  test "postponed paused modules remain searchable and activity links remain reachable" do
    ActivityEvent.record!(event_type: "video_started", actor: @student, cohort: @cohort, record: @block)
    @enrollment.update!(status: :paused)
    @assignment.update!(unlock_date_override: 10.days.from_now.to_date)
    as_user(@student) do
      get "/api/v1/search", params: { q: "Week" }, headers: auth_headers
      assert_response :success
      assert response.parsed_body.fetch("groups").any? { |group| group["type"] == "module" && group["results"].any? { |item| item["id"].to_i == @mod.id } }
      get "/api/v1/activity_events", params: { cohort_id: @cohort.id }, headers: auth_headers
      assert_response :success
      assert response.parsed_body.fetch("activity_events").any? { |event| event.dig("destination", "lesson_id") == @lesson.id }
    end
  end

  test "active date postponement still denies module lesson and video" do
    @assignment.update!(unlock_date_override: 10.days.from_now.to_date)
    assert_equal({ lesson: 403, module: 403, video: 403 }, reads)
  end

  def reads
    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", params: { cohort_id: @cohort.id }, headers: auth_headers
      lesson = response.status
      get "/api/v1/modules/#{@mod.id}", params: { cohort_id: @cohort.id }, headers: auth_headers
      mod = response.status
      get "/api/v1/content_blocks/#{@block.id}/video_stream", params: { cohort_id: @cohort.id }, headers: auth_headers
      video = response.status
      { lesson: lesson, module: mod, video: video }
    end
  end

  test "paused library before and after a cohort start-date postponement" do
    @enrollment.update!(status: :paused)
    before = reads
    @cohort.update!(start_date: 10.days.from_now.to_date)
    after = reads
    assert_equal({ lesson: 200, module: 200, video: 200 }, before)
    assert_equal before, after, "every learner read path should agree on the frozen paused library"
  end

  test "paused library after a module date override moves later" do
    @enrollment.update!(status: :paused)
    before = reads
    @assignment.update!(unlock_date_override: 10.days.from_now.to_date)
    after = reads
    assert_equal({ lesson: 200, module: 200, video: 200 }, before)
    assert_equal before, after
  end

  def auth_headers = { "Authorization" => "Bearer test" }

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
