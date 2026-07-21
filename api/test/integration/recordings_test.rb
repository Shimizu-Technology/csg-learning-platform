require "test_helper"

class RecordingsTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp 2026")
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Prework", position: 0)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)

    @student = User.create!(
      clerk_id: "clerk_student",
      email: "student@example.com",
      first_name: "Student",
      last_name: "User",
      role: :student
    )
    @other_student = User.create!(
      clerk_id: "clerk_other",
      email: "other@example.com",
      first_name: "Other",
      last_name: "User",
      role: :student
    )
    @admin = User.create!(
      clerk_id: "clerk_admin",
      email: "admin@example.com",
      first_name: "Admin",
      last_name: "User",
      role: :admin
    )

    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @module)
  end

  test "staff can create recording when s3 content type includes parameters" do
    with_s3_metadata(content_type: "video/mp4; charset=binary", content_length: 1234) do
      as_user(@admin) do
        post "/api/v1/cohorts/#{@cohort.id}/recordings",
          params: {
            title: "Class 1",
            s3_key: "recordings/cohort_#{@cohort.id}/class-1.mp4",
            content_type: "video/mp4",
            file_size: 1234
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    assert_equal "Class 1", Recording.last.title
  end

  test "recording create rejects keys outside cohort prefix" do
    with_s3_metadata(content_type: "video/mp4", content_length: 1234) do
      as_user(@admin) do
        post "/api/v1/cohorts/#{@cohort.id}/recordings",
          params: {
            title: "Forged",
            s3_key: "recordings/cohort_999/forged.mp4",
            content_type: "video/mp4",
            file_size: 1234
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :unprocessable_entity
    assert_equal 0, Recording.count
  end

  test "recording create rejects missing s3 object" do
    with_s3_metadata(nil) do
      as_user(@admin) do
        post "/api/v1/cohorts/#{@cohort.id}/recordings",
          params: {
            title: "Missing",
            s3_key: "recordings/cohort_#{@cohort.id}/missing.mp4",
            content_type: "video/mp4",
            file_size: 1234
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :unprocessable_entity
    assert_equal 0, Recording.count
  end

  test "student can stream enrolled cohort recording" do
    recording = create_recording!

    with_s3_stream_url("https://signed.example/video.mp4") do
      as_user(@student) do
        get "/api/v1/cohorts/#{@cohort.id}/recordings/#{recording.id}/stream_url", headers: auth_headers
      end
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "https://signed.example/video.mp4", body.fetch("stream_url")
    assert_in_delta 2.hours.from_now.to_i, Time.iso8601(body.fetch("expires_at")).to_i, 2
  end

  test "student recordings endpoint returns one normalized recording list" do
    create_recording!(title: "Uploaded Class")
    @cohort.update!(
      settings: {
        "recordings" => [
          { "title" => "YouTube Class", "url" => "https://youtube.com/watch?v=abc123", "date" => "2026-05-01" },
          { "title" => "External Replay", "url" => "https://vimeo.com/123", "date" => "2026-05-02" }
        ]
      }
    )

    as_user(@student) do
      get "/api/v1/recordings", headers: auth_headers
    end

    assert_response :success
    items = JSON.parse(response.body).fetch("items")
    assert_equal [ "uploaded", "youtube", "external" ], items.map { |item| item.fetch("source") }
    assert_equal [ "Uploaded Class", "YouTube Class", "External Replay" ], items.map { |item| item.fetch("title") }
    assert_equal [ @cohort.name ], items.map { |item| item.fetch("cohort_name") }.uniq
    assert items.all? { |item| item.fetch("item_key").present? }
  end

  test "unenrolled student cannot stream recording" do
    recording = create_recording!

    with_s3_stream_url("https://signed.example/video.mp4") do
      as_user(@other_student) do
        get "/api/v1/cohorts/#{@cohort.id}/recordings/#{recording.id}/stream_url", headers: auth_headers
      end
    end

    assert_response :forbidden
  end

  test "watch progress completes at ninety percent and caps duration" do
    recording = create_recording!(duration_seconds: 100)

    as_user(@student) do
      patch "/api/v1/watch_progress",
        params: {
          recording_id: recording.id,
          last_position_seconds: 150,
          total_watched_seconds: 95,
          duration_seconds: 100
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    progress = @student.watch_progresses.find_by!(recording: recording)
    assert_equal 100, progress.last_position_seconds
    assert_equal 95, progress.total_watched_seconds
    assert progress.completed?
  end

  test "cohort watch matrix includes not started recordings" do
    create_recording!(title: "Class 1")
    create_recording!(title: "Class 2", s3_key: "recordings/cohort_#{@cohort.id}/class-2.mp4", position: 1)

    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/watch_progress", headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal [ "Class 1", "Class 2" ], body.fetch("recordings").map { |r| r.fetch("title") }
    student_row = body.fetch("students").find { |s| s.fetch("user_id") == @student.id }
    assert_equal [ 0, 0 ], student_row.fetch("recordings").map { |r| r.fetch("progress_percentage") }
  end

  private

  def create_recording!(title: "Class 1", s3_key: "recordings/cohort_#{@cohort.id}/class-1.mp4", position: 0, duration_seconds: 120)
    Recording.create!(
      cohort: @cohort,
      uploaded_by: @admin,
      title: title,
      s3_key: s3_key,
      content_type: "video/mp4",
      file_size: 1234,
      duration_seconds: duration_seconds,
      position: position
    )
  end

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

  def with_s3_metadata(metadata)
    original_configured = S3Service.method(:configured?)
    original_metadata = S3Service.method(:object_metadata)

    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:object_metadata) { |_key| metadata }
    yield
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:object_metadata, original_metadata)
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
