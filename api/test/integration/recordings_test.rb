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
    @instructor = User.create!(
      clerk_id: "clerk_instructor",
      email: "instructor@example.com",
      first_name: "Instructor",
      last_name: "User",
      role: :instructor
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

  test "instructor can presign and save a cohort recording as a draft" do
    post_data = Struct.new(:url, :fields).new("https://s3.example/upload", { "key" => "signed-key" })
    original_configured = S3Service.method(:configured?)
    original_post = S3Service.method(:generate_presigned_post)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_post) { |_key, _content_type| post_data }

    as_user(@instructor) do
      post "/api/v1/cohorts/#{@cohort.id}/recordings_presign",
        params: { filename: "Class 1.mov", content_type: "video/quicktime" },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    signed = JSON.parse(response.body)
    assert_equal "https://s3.example/upload", signed.fetch("upload_url")

    with_s3_metadata(content_type: "video/quicktime", content_length: 1234) do
      as_user(@instructor) do
        post "/api/v1/cohorts/#{@cohort.id}/recordings",
          params: {
            title: "Class 1",
            s3_key: signed.fetch("s3_key"),
            content_type: "video/quicktime",
            file_size: 1234
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    assert_equal @instructor, Recording.last.uploaded_by
    assert Recording.last.draft?
    assert_equal "draft", JSON.parse(response.body).dig("recording", "status")
  ensure
    S3Service.define_singleton_method(:configured?, original_configured) if original_configured
    S3Service.define_singleton_method(:generate_presigned_post, original_post) if original_post
  end

  test "staff can publish a recording immediately during creation" do
    with_s3_metadata(content_type: "video/mp4", content_length: 1234) do
      as_user(@instructor) do
        post "/api/v1/cohorts/#{@cohort.id}/recordings",
          params: {
            title: "Ready for students",
            s3_key: "recordings/cohort_#{@cohort.id}/ready.mp4",
            content_type: "video/mp4",
            file_size: 1234,
            publish_immediately: true
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    assert_equal "published", JSON.parse(response.body).dig("recording", "status")
    assert Recording.find_by!(title: "Ready for students").published?
  end

  test "staff can publish a draft and return it to draft" do
    recording = create_recording!(status: :draft)

    as_user(@instructor) do
      patch "/api/v1/cohorts/#{@cohort.id}/recordings/#{recording.id}",
        params: { status: "published" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert recording.reload.published?

    as_user(@instructor) do
      patch "/api/v1/cohorts/#{@cohort.id}/recordings/#{recording.id}",
        params: { status: "draft" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert recording.reload.draft?
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

    expires_in = with_s3_stream_url("https://signed.example/video.mp4") do
      as_user(@student) do
        get "/api/v1/cohorts/#{@cohort.id}/recordings/#{recording.id}/stream_url", headers: auth_headers
      end
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal "https://signed.example/video.mp4", body.fetch("stream_url")
    assert_equal S3Service::VIDEO_STREAM_EXPIRY, expires_in
    assert_in_delta S3Service::VIDEO_STREAM_EXPIRY.seconds.from_now.to_i, Time.iso8601(body.fetch("expires_at")).to_i, 2
  end

  test "student cannot list, show, stream, or track a draft recording" do
    draft = create_recording!(title: "Staff draft", status: :draft)

    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/recordings", headers: auth_headers
    end
    assert_response :success
    assert_empty JSON.parse(response.body).fetch("recordings")

    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/recordings/#{draft.id}", headers: auth_headers
    end
    assert_response :forbidden

    as_user(@student) do
      get "/api/v1/cohorts/#{@cohort.id}/recordings/#{draft.id}/stream_url", headers: auth_headers
    end
    assert_response :forbidden

    as_user(@student) do
      patch "/api/v1/watch_progress",
        params: { recording_id: draft.id, last_position_seconds: 10, total_watched_seconds: 10 },
        headers: auth_headers,
        as: :json
    end
    assert_response :forbidden
    assert_not WatchProgress.exists?(user: @student, recording: draft)
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

  test "student recordings endpoint excludes drafts while staff can review them" do
    draft = create_recording!(title: "Unpublished class", status: :draft)

    as_user(@student) do
      get "/api/v1/recordings", headers: auth_headers
    end
    assert_response :success
    assert_empty JSON.parse(response.body).fetch("s3_recordings")

    as_user(@instructor) do
      get "/api/v1/recordings", headers: auth_headers
    end
    assert_response :success
    item = JSON.parse(response.body).fetch("s3_recordings").sole
    assert_equal draft.id, item.fetch("id")
    assert_equal "draft", item.fetch("status")
  end

  test "staff recordings endpoint spans active cohorts without requiring enrollment" do
    create_recording!(title: "Staff review recording")

    as_user(@admin) do
      get "/api/v1/recordings", headers: auth_headers
    end

    assert_response :success
    item = JSON.parse(response.body).fetch("items").first
    assert_equal "Staff review recording", item.fetch("title")
    assert_equal @cohort.id, item.fetch("cohort_id")
    assert_nil item["watch_progress"]
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

  test "watch progress rejects a request from before the enrollment reset" do
    recording = create_recording!(duration_seconds: 100)
    @enrollment.update!(learning_state_reset_at: 1.minute.from_now)

    as_user(@student) do
      patch "/api/v1/watch_progress",
        params: {
          recording_id: recording.id,
          last_position_seconds: 30,
          total_watched_seconds: 30,
          duration_seconds: 100
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :conflict
    assert_not WatchProgress.exists?(user: @student, recording: recording)
    assert_match "restarted", JSON.parse(response.body).fetch("error")
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

  test "student and cohort lesson video progress use the modules table alias" do
    lesson = Lesson.create!(curriculum_module: @module, title: "Replay lesson", release_day: 0, position: 0)
    block = ContentBlock.create!(
      lesson: lesson,
      block_type: :video,
      title: "Replay",
      position: 0,
      s3_video_key: "content_videos/replay.mp4",
      s3_video_duration_seconds: 120
    )
    Progress.create!(
      user: @student,
      content_block: block,
      status: :in_progress,
      video_last_position: 30,
      video_total_watched: 45
    )

    as_user(@admin) do
      get "/api/v1/watch_progress/student/#{@student.id}/lesson_videos", headers: auth_headers
    end

    assert_response :success
    student_row = JSON.parse(response.body).fetch("lesson_videos").sole
    assert_equal block.id, student_row.fetch("content_block_id")
    assert_equal 37.5, student_row.fetch("progress_percentage")

    as_user(@admin) do
      get "/api/v1/cohorts/#{@cohort.id}/lesson_video_progress", headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal [ block.id ], body.fetch("videos").map { |video| video.fetch("id") }
    assert_equal 37.5, body.fetch("students").sole.fetch("videos").sole.fetch("progress_percentage")
  end

  test "student watch endpoints can be scoped to one enrollment cohort" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Earlier cohort", start_date: 1.year.ago, status: :completed)
    Enrollment.create!(user: @student, cohort: other_cohort, status: :completed)
    current_recording = create_recording!(title: "Current replay")
    Recording.create!(
      cohort: other_cohort,
      uploaded_by: @admin,
      title: "Earlier replay",
      s3_key: "recordings/cohort_#{other_cohort.id}/earlier.mp4",
      content_type: "video/mp4",
      file_size: 1234,
      duration_seconds: 120,
      position: 0
    )

    as_user(@admin) do
      get "/api/v1/watch_progress/student/#{@student.id}", params: { cohort_id: @cohort.id }, headers: auth_headers
    end

    assert_response :success
    rows = JSON.parse(response.body).fetch("watch_progresses")
    assert_equal [ current_recording.id ], rows.map { |row| row.fetch("recording_id") }
  end

  test "student watch endpoints reject a cohort outside the student's enrollments" do
    unrelated = Cohort.create!(curriculum: @curriculum, name: "Unrelated cohort", start_date: Date.current, status: :active)

    as_user(@admin) do
      get "/api/v1/watch_progress/student/#{@student.id}", params: { cohort_id: unrelated.id }, headers: auth_headers
    end
    assert_response :not_found
    assert_equal "Student is not enrolled in this cohort", JSON.parse(response.body).fetch("error")

    as_user(@admin) do
      get "/api/v1/watch_progress/student/#{@student.id}/lesson_videos", params: { cohort_id: unrelated.id }, headers: auth_headers
    end
    assert_response :not_found
    assert_equal "Student is not enrolled in this cohort", JSON.parse(response.body).fetch("error")
  end

  private

  def create_recording!(title: "Class 1", s3_key: "recordings/cohort_#{@cohort.id}/class-1.mp4", position: 0, duration_seconds: 120, status: :published)
    Recording.create!(
      cohort: @cohort,
      uploaded_by: @admin,
      title: title,
      s3_key: s3_key,
      content_type: "video/mp4",
      file_size: 1234,
      duration_seconds: duration_seconds,
      status: status,
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
    captured_expiry = nil

    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_url) do |_key, expires_in:|
      captured_expiry = expires_in
      url
    end
    yield
    captured_expiry
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:generate_presigned_url, original_url)
  end
end
