require "test_helper"

class LessonsApiTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @curriculum_module = CurriculumModule.create!(
      curriculum: @curriculum,
      name: "Week 1",
      position: 0,
      day_offset: 0,
      schedule_days: "daily"
    )
    @lesson = Lesson.create!(
      curriculum_module: @curriculum_module,
      title: "Lesson 1",
      position: 0,
      release_day: 0
    )
    @video_block = @lesson.content_blocks.create!(
      block_type: :video,
      position: 1,
      title: "Intro",
      s3_video_key: "content_blocks/cohort_#{@cohort.id}/intro.mp4"
    )

    @student = User.create!(
      clerk_id: "clerk_student_lessons_api",
      email: "student-lessons@example.com",
      first_name: "Student",
      last_name: "Viewer",
      role: :student
    )
    @admin = User.create!(
      clerk_id: "clerk_admin_lessons_api",
      email: "admin-lessons@example.com",
      first_name: "Admin",
      last_name: "Editor",
      role: :admin
    )

    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @curriculum_module, unlocked: true)
  end

  test "student lesson payload includes self-hosted video key" do
    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :success
    block = JSON.parse(response.body).dig("lesson", "content_blocks").find { |item| item["id"] == @video_block.id }
    assert_equal @video_block.s3_video_key, block["s3_video_key"]
    assert_equal true, block["completion_required"]
    refute block.key?("s3_video_content_type")
  end

  test "lesson payload identifies only actionable completion blocks when an exercise exists" do
    exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 2, title: "Submit")

    as_user(@student) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :success
    blocks = JSON.parse(response.body).dig("lesson", "content_blocks").index_by { |item| item["id"] }
    assert_equal false, blocks.fetch(@video_block.id)["completion_required"]
    assert_equal true, blocks.fetch(exercise.id)["completion_required"]
  end

  test "staff lesson payload still includes video metadata" do
    @video_block.update!(
      s3_video_content_type: "video/mp4",
      s3_video_size: 123,
      s3_video_uploaded_by: @admin,
      s3_video_uploaded_at: Time.zone.parse("2026-04-29 16:30")
    )

    as_user(@admin) do
      get "/api/v1/lessons/#{@lesson.id}", headers: auth_headers
    end

    assert_response :success
    block = JSON.parse(response.body).dig("lesson", "content_blocks").find { |item| item["id"] == @video_block.id }
    assert_equal @video_block.s3_video_key, block["s3_video_key"]
    assert_equal "video/mp4", block["s3_video_content_type"]
    assert_equal 123, block["s3_video_size"]
    assert_equal @admin.full_name, block["s3_video_uploaded_by"]
    assert block["s3_video_uploaded_at"].present?
  end

  test "staff content block update stamps self-hosted video upload metadata" do
    @video_block.update!(s3_video_key: nil)

    as_user(@admin) do
      patch "/api/v1/content_blocks/#{@video_block.id}",
            params: {
              s3_video_key: "content_videos/block_#{@video_block.id}/class.mp4",
              s3_video_content_type: "video/mp4",
              s3_video_size: 123
            },
            headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body).fetch("content_block")
    assert_equal "content_videos/block_#{@video_block.id}/class.mp4", body.fetch("s3_video_key")
    assert_equal @admin.full_name, body.fetch("s3_video_uploaded_by")
    assert body.fetch("s3_video_uploaded_at").present?
  end

  test "student video stream response includes explicit signed URL expiry" do
    with_s3_stream_url("https://signed.example/lesson.mp4") do
      as_user(@student) do
        get "/api/v1/content_blocks/#{@video_block.id}/video_stream", headers: auth_headers
      end
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "https://signed.example/lesson.mp4", body.fetch("stream_url")
    assert_in_delta 2.hours.from_now.to_i, Time.iso8601(body.fetch("expires_at")).to_i, 2
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }

    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end

  def with_s3_stream_url(url)
    original_configured = S3Service.method(:configured?)
    original_url = S3Service.method(:generate_presigned_url)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_url) { |_key, expires_in:| url }
    yield
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:generate_presigned_url, original_url)
  end
end
