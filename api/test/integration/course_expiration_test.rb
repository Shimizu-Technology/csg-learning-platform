require "test_helper"

class CourseExpirationTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Expiration QA", status: :active)
    @module = @curriculum.modules.create!(name: "Variables", position: 0, schedule_days: "daily")
    @lesson = @module.lessons.create!(title: "First variable", position: 0, release_day: 0)
    @video = @lesson.content_blocks.create!(block_type: :video, title: "Variable demo", position: 0, s3_video_key: "content_videos/#{SecureRandom.uuid}/demo.mp4")
    @student = User.create!(clerk_id: "expiration_student", email: "expiration@example.com", role: :student)
    @admin = User.create!(clerk_id: "expiration_admin", email: "expiration-admin@example.com", role: :admin)
    @cohort = Cohort.create!(name: "Expiration course", curriculum: @curriculum, start_date: Date.current - 1.month, status: :active)
    @enrollment = @cohort.enrollments.create!(user: @student, access_expires_at: 1.day.from_now)
    @enrollment.module_assignments.create!(curriculum_module: @module, unlocked: true)
    @recording = @cohort.recordings.create!(title: "First class", s3_key: "recordings/cohort_#{@cohort.id}/20261010010000_abcdef12_class.mp4", content_type: "video/mp4", file_size: 1234, status: :published)
    @announcement = Announcement.create!(cohort: @cohort, author: @admin, title: "Class notice", body: "A course notice", status: :published)
  end

  test "selected cohort reads reject expired self-paced access" do
    @cohort.update!(course_delivery: "self_paced")
    @enrollment.update!(access_expires_at: 1.minute.ago)
    assert_course_reads(:forbidden)
  end

  test "guided reads stop at the inclusive Guam date boundary" do
    @cohort.update!(course_delivery: "guided", guided_access_ends_on: Date.new(2027, 3, 20))
    @enrollment.update!(access_expires_at: Time.find_zone!("Pacific/Guam").local(2027, 3, 21))
    travel_to Time.find_zone!("Pacific/Guam").local(2027, 3, 20, 23, 59, 59) do
      assert_course_reads(:success)
    end
    travel_to Time.find_zone!("Pacific/Guam").local(2027, 3, 21) do
      assert_course_reads(:forbidden)
    end
  end

  test "completed enrollment cannot bypass its access deadline" do
    @enrollment.update!(status: :completed, access_expires_at: 1.minute.ago)
    assert_course_reads(:forbidden)
  end

  test "completed program with indefinite access stays readable" do
    @enrollment.update!(status: :completed, access_expires_at: nil)
    assert_course_reads(:success)
  end

  test "paused and dropped enrollments do not gain access from an unexpired deadline" do
    %i[paused dropped].each do |status|
      @enrollment.update!(status: status)
      assert_course_reads(:forbidden)
    end
  end

  test "completed enrollment keeps read-only access until its deadline" do
    @enrollment.update!(status: :completed)
    assert_course_reads(:success)
    as_user(@student) do
      patch "/api/v1/watch_progress", params: { recording_id: @recording.id, last_position_seconds: 20, total_watched_seconds: 20 }, headers: headers, as: :json
    end
    assert_response :forbidden
  end

  test "expired course disappears from learner lists without hiding community membership" do
    @enrollment.update!(access_expires_at: 1.minute.ago)
    community = Workspace.create!(name: "Community QA", slug: "expiration-community", workspace_type: :community)
    community.workspace_memberships.create!(user: @student)
    @cohort.workspace.workspace_memberships.create!(user: @student)

    as_user(@student) do
      get "/api/v1/cohorts/accessible", headers: headers
      assert_response :success
      assert_empty JSON.parse(response.body).fetch("cohorts")
      get "/api/v1/workspaces", headers: headers
      assert_response :success
      assert_equal [ community.id ], JSON.parse(response.body).fetch("workspaces").map { |item| item.fetch("id") }
      get "/api/v1/recordings", headers: headers
      assert_response :success
      assert_empty JSON.parse(response.body).fetch("items")
      get "/api/v1/announcements", headers: headers
      assert_response :success
      assert_empty JSON.parse(response.body).fetch("announcements")
    end
  end

  test "expired recording progress writes are denied without saving evidence" do
    @enrollment.update!(access_expires_at: 1.minute.ago)
    assert_no_difference("WatchProgress.count") do
      as_user(@student) do
        patch "/api/v1/watch_progress", params: { recording_id: @recording.id, last_position_seconds: 20, total_watched_seconds: 20 }, headers: headers, as: :json
      end
    end
    assert_response :forbidden
  end

  test "learner video URLs cannot outlive the enrollment deadline" do
    @enrollment.update!(access_expires_at: 30.seconds.from_now)
    with_s3 do |expiries|
      as_user(@student) do
        get "/api/v1/content_blocks/#{@video.id}/video_stream", params: { cohort_id: @cohort.id }, headers: headers
        assert_response :success
        assert Time.iso8601(JSON.parse(response.body).fetch("expires_at")) <= @enrollment.access_expires_at
        get "/api/v1/cohorts/#{@cohort.id}/recordings/#{@recording.id}/stream_url", headers: headers
        assert_response :success
        assert Time.iso8601(JSON.parse(response.body).fetch("expires_at")) <= @enrollment.access_expires_at
      end
      assert_equal 2, expiries.size
      assert expiries.all? { |expiry| expiry.positive? && expiry <= 30 }
    end
  end

  test "staff can still inspect an expired course and use normal stream lifetime" do
    @enrollment.update!(access_expires_at: 1.minute.ago)
    with_s3 do |expiries|
      as_user(@admin) do
        get "/api/v1/content_blocks/#{@video.id}/video_stream", params: { cohort_id: @cohort.id }, headers: headers
        assert_response :success
        get "/api/v1/cohorts/#{@cohort.id}/recordings/#{@recording.id}/stream_url", headers: headers
        assert_response :success
      end
      assert_equal [ S3Service::VIDEO_STREAM_EXPIRY ] * 2, expiries
    end
  end

  private

  def assert_course_reads(expected)
    with_s3 do
      as_user(@student) do
        [
          [ "/api/v1/lessons/#{@lesson.id}", { cohort_id: @cohort.id } ],
          [ "/api/v1/modules/#{@module.id}", { cohort_id: @cohort.id } ],
          [ "/api/v1/dashboard", { cohort_id: @cohort.id } ],
          [ "/api/v1/weekly_plan", { cohort_id: @cohort.id } ],
          [ "/api/v1/cohorts/#{@cohort.id}/home", {} ],
          [ "/api/v1/content_blocks/#{@video.id}/video_stream", { cohort_id: @cohort.id } ],
          [ "/api/v1/cohorts/#{@cohort.id}/recordings/#{@recording.id}/stream_url", {} ],
          [ "/api/v1/workspaces/#{@cohort.workspace.id}", {} ],
          [ "/api/v1/announcements/#{@announcement.id}", {} ]
        ].each do |path, parameters|
          get path, params: parameters, headers: headers
          assert_response expected, path
        end
      end
    end
  end

  def with_s3
    expiries = []
    original_configured = S3Service.method(:configured?)
    original_url = S3Service.method(:generate_presigned_url)
    S3Service.define_singleton_method(:configured?) { true }
    S3Service.define_singleton_method(:generate_presigned_url) do |_key, expires_in:|
      expiries << expires_in
      "https://storage.example.test/video"
    end
    yield expiries
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
    S3Service.define_singleton_method(:generate_presigned_url, original_url)
  end

  def headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
