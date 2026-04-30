require "test_helper"

class UploadsTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp 2026")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Live Class", position: 0)
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Week 1", release_day: 1)
    @content_block = ContentBlock.create!(lesson: @lesson, block_type: :video, title: "Class recording", position: 0)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
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
  end

  test "staff can initiate cohort recording multipart upload" do
    with_s3_multipart_stubs do
      as_user(@admin) do
        post "/api/v1/uploads/multipart/initiate",
          params: {
            cohort_id: @cohort.id,
            filename: "Day 2 Zoom.mp4",
            content_type: "video/mp4",
            file_size: 516.megabytes
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_match %r{\Arecordings/cohort_#{@cohort.id}/}, body.fetch("s3_key")
    assert_equal "multipart-upload-id", body.fetch("upload_id")
    assert_includes body.fetch("s3_key"), "Day_2_Zoom.mp4"
  end

  test "staff can initiate content block multipart upload" do
    with_s3_multipart_stubs do
      as_user(@admin) do
        post "/api/v1/uploads/multipart/initiate",
          params: {
            content_block_id: @content_block.id,
            filename: "Lesson Clip.mov",
            content_type: "video/quicktime",
            file_size: 200.megabytes
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_match %r{\Acontent_videos/block_#{@content_block.id}/\d{14}_[0-9a-f]{8}_Lesson_Clip\.mov\z}, body.fetch("s3_key")
  end

  test "multipart part url rejects invalid s3 key prefixes" do
    with_s3_multipart_stubs do
      as_user(@admin) do
        post "/api/v1/uploads/multipart/part_url",
          params: {
            s3_key: "other/path/video.mp4",
            upload_id: "multipart-upload-id",
            part_number: 1
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :bad_request
  end

  test "instructors can sign recording parts but not content video parts" do
    with_s3_multipart_stubs do
      as_user(@instructor) do
        post "/api/v1/uploads/multipart/part_url",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id",
            part_number: 1
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :success

      as_user(@instructor) do
        post "/api/v1/uploads/multipart/part_url",
          params: {
            s3_key: "content_videos/block_#{@content_block.id}/video.mp4",
            upload_id: "multipart-upload-id",
            part_number: 1
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :forbidden
    end
  end

  test "instructors cannot complete or abort content video multipart uploads" do
    with_s3_multipart_stubs do
      as_user(@instructor) do
        post "/api/v1/uploads/multipart/complete",
          params: {
            s3_key: "content_videos/block_#{@content_block.id}/video.mp4",
            upload_id: "multipart-upload-id",
            parts: [
              { part_number: 1, etag: "\"etag-1\"" }
            ]
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :forbidden

      as_user(@instructor) do
        delete "/api/v1/uploads/multipart/abort",
          params: {
            s3_key: "content_videos/block_#{@content_block.id}/video.mp4",
            upload_id: "multipart-upload-id"
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :forbidden
    end
  end

  test "staff can sign complete and abort multipart uploads" do
    with_s3_multipart_stubs do
      as_user(@admin) do
        post "/api/v1/uploads/multipart/part_url",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id",
            part_number: 2
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :success
      assert_equal "https://s3.example/part", JSON.parse(response.body).fetch("upload_url")

      as_user(@admin) do
        post "/api/v1/uploads/multipart/complete",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id",
            parts: [
              { part_number: 2, etag: "\"etag-2\"" },
              { part_number: 1, etag: "\"etag-1\"" }
            ]
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :no_content

      as_user(@admin) do
        delete "/api/v1/uploads/multipart/abort",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id"
          },
          headers: auth_headers,
          as: :json
      end

      assert_response :no_content
    end
  end

  test "multipart complete rejects out of range part numbers" do
    with_s3_multipart_stubs do
      as_user(@admin) do
        post "/api/v1/uploads/multipart/complete",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id",
            parts: [
              { part_number: 0, etag: "\"etag-0\"" },
              { part_number: 1, etag: "\"etag-1\"" }
            ]
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :unprocessable_entity
    assert_equal "part_number must be between 1 and 10000", JSON.parse(response.body).fetch("error")
  end

  test "multipart initiate returns bad gateway when s3 rejects create" do
    with_s3_multipart_stubs do
      S3Service.define_singleton_method(:create_multipart_upload) do |_key, _content_type|
        raise Aws::S3::Errors::ServiceError.new(nil, "upstream error")
      end

      as_user(@admin) do
        post "/api/v1/uploads/multipart/initiate",
          params: {
            cohort_id: @cohort.id,
            filename: "Day 2 Zoom.mp4",
            content_type: "video/mp4",
            file_size: 516.megabytes
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :bad_gateway
    assert_equal "Could not start multipart upload. Please try again.", JSON.parse(response.body).fetch("error")
  end

  test "multipart complete returns bad gateway when s3 rejects completion" do
    with_s3_multipart_stubs do
      S3Service.define_singleton_method(:complete_multipart_upload) do |_key, _upload_id, _parts|
        raise Aws::S3::Errors::ServiceError.new(nil, "upstream error")
      end

      as_user(@admin) do
        post "/api/v1/uploads/multipart/complete",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id",
            parts: [
              { part_number: 1, etag: "\"etag-1\"" }
            ]
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :bad_gateway
    assert_equal "Could not complete multipart upload. Please try again.", JSON.parse(response.body).fetch("error")
  end

  test "multipart part url returns bad gateway when s3 rejects presign" do
    with_s3_multipart_stubs do
      S3Service.define_singleton_method(:generate_presigned_upload_part_url) do |_key, _upload_id, _part_number|
        raise Aws::S3::Errors::ServiceError.new(nil, "upstream error")
      end

      as_user(@admin) do
        post "/api/v1/uploads/multipart/part_url",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id",
            part_number: 1
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :bad_gateway
    assert_equal "Could not prepare upload part. Please try again.", JSON.parse(response.body).fetch("error")
  end

  test "multipart abort returns bad gateway when s3 abort fails" do
    with_s3_multipart_stubs do
      S3Service.define_singleton_method(:abort_multipart_upload) { |_key, _upload_id| false }

      as_user(@admin) do
        delete "/api/v1/uploads/multipart/abort",
          params: {
            s3_key: "recordings/cohort_#{@cohort.id}/video.mp4",
            upload_id: "multipart-upload-id"
          },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :bad_gateway
    assert_equal "Could not abort multipart upload. Please try again.", JSON.parse(response.body).fetch("error")
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

  def with_s3_multipart_stubs
    original_configured = S3Service.method(:configured?)
    original_create = S3Service.method(:create_multipart_upload)
    original_part_url = S3Service.method(:generate_presigned_upload_part_url)
    original_complete = S3Service.method(:complete_multipart_upload)
    original_abort = S3Service.method(:abort_multipart_upload)

    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:create_multipart_upload) { |_key, _content_type| "multipart-upload-id" }
    S3Service.define_singleton_method(:generate_presigned_upload_part_url) { |_key, _upload_id, _part_number| "https://s3.example/part" }
    S3Service.define_singleton_method(:complete_multipart_upload) { |_key, _upload_id, _parts| true }
    S3Service.define_singleton_method(:abort_multipart_upload) { |_key, _upload_id| true }

    yield
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:create_multipart_upload, original_create)
    S3Service.define_singleton_method(:generate_presigned_upload_part_url, original_part_url)
    S3Service.define_singleton_method(:complete_multipart_upload, original_complete)
    S3Service.define_singleton_method(:abort_multipart_upload, original_abort)
  end
end
