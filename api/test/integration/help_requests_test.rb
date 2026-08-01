require "test_helper"

class HelpRequestsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  def setup
    @curriculum = Curriculum.create!(name: "Contextual help")
    @mod = CurriculumModule.create!(curriculum: @curriculum, name: "Foundations", position: 0, day_offset: 0, schedule_days: "daily")
    @lesson = Lesson.create!(curriculum_module: @mod, title: "Nested routes", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Build the route", submission_type: :text_submission)
    @student = User.create!(clerk_id: "help_api_student", email: "help-api-student@example.com", first_name: "Help", last_name: "Student", role: :student)
    @other_student = User.create!(clerk_id: "help_api_other", email: "help-api-other@example.com", first_name: "Other", last_name: "Student", role: :student)
    @staff = User.create!(clerk_id: "help_api_staff", email: "help-api-staff@example.com", first_name: "Help", last_name: "Instructor", role: :instructor)
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Help cohort", start_date: Date.current, status: :active, settings: { "recordings" => [ { "title" => "Legacy replay", "url" => "https://example.com/replay" } ] })
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @enrollment.module_assignments.create!(curriculum_module: @mod, unlocked: true)
    @recording = @cohort.recordings.create!(title: "Uploaded replay", s3_key: "help/replay.mp4", content_type: "video/mp4", file_size: 1.megabyte, position: 0)
  end

  test "student creates one contextual request and staff are notified without message content" do
    assert_enqueued_with(job: PushNotificationJob) do
      as_user(@student) do
        post "/api/v1/help_requests", params: {
          help_request: {
            cohort_id: @cohort.id,
            context_type: "exercise",
            context_source: "primary",
            context_id: @block.id,
            category: "technical",
            urgency: "urgent",
            message: "My route loops after I submit the form."
          }
        }, headers: auth_headers
      end
    end

    assert_response :created
    payload = JSON.parse(response.body)
    assert payload.fetch("created")
    request = HelpRequest.find(payload.dig("help_request", "id"))
    assert_equal @block.title, request.context_label
    notification = Notification.find_by!(notifiable: request, user: @staff)
    assert_equal "help_request", notification.notification_type
    refute_includes notification.body, request.message

    as_user(@student) do
      post "/api/v1/help_requests", params: {
        help_request: {
          cohort_id: @cohort.id,
          context_type: "exercise",
          context_source: "primary",
          context_id: @block.id,
          category: "technical",
          urgency: "urgent",
          message: "A duplicate request"
        }
      }, headers: auth_headers
    end

    assert_response :success
    refute JSON.parse(response.body).fetch("created")
    assert_equal 1, @student.help_requests.active_queue.count
  end

  test "student can request help on uploaded and legacy recordings" do
    [ [ "primary", @recording.id ], [ "legacy", 0 ] ].each do |source, context_id|
      as_user(@student) do
        post "/api/v1/help_requests", params: {
          help_request: {
            cohort_id: @cohort.id,
            context_type: "recording",
            context_source: source,
            context_id: context_id,
            category: "concept",
            urgency: "normal",
            message: "Which part should I review first?"
          }
        }, headers: auth_headers
      end
      assert_response :created
    end

    assert_equal [ "Legacy replay", "Uploaded replay" ], @student.help_requests.order(:context_label).pluck(:context_label)
  end

  test "staff acknowledges and resolves while the student sees response state" do
    request = create_help_request
    NotificationDeliveryService.help_request_created(request, push: false)

    as_user(@staff) do
      patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "acknowledged" } }, headers: auth_headers
    end
    assert_response :success
    assert request.reload.status_acknowledged?
    assert_equal @staff, request.owner

    as_user(@staff) do
      patch "/api/v1/help_requests/#{request.id}", params: {
        help_request: { status: "resolved", staff_response: "Compare the nested resource path with the router output." }
      }, headers: auth_headers
    end
    assert_response :success
    assert request.reload.status_resolved?
    assert_equal "Compare the nested resource path with the router output.", request.staff_response
    assert_nil Notification.find_by!(notifiable: request, user: @student).read_at
    assert Notification.find_by!(notifiable: request, user: @staff).read_at

    as_user(@student) { get "/api/v1/help_requests", headers: auth_headers }
    assert_response :success
    student_payload = JSON.parse(response.body).fetch("help_requests").first
    assert_equal "resolved", student_payload.fetch("status")
    assert_equal request.staff_response, student_payload.fetch("staff_response")
    refute student_payload.key?("student")
  end

  test "staff must respond before resolving and cannot reopen terminal requests" do
    request = create_help_request

    as_user(@staff) do
      patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "resolved", staff_response: "  " } }, headers: auth_headers
    end
    assert_response :unprocessable_entity
    assert request.reload.status_open?

    as_user(@staff) do
      patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "resolved", staff_response: "Try the inner route first." } }, headers: auth_headers
    end
    assert_response :success
    resolved_at = request.reload.resolved_at

    as_user(@staff) do
      patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "acknowledged" } }, headers: auth_headers
    end
    assert_response :unprocessable_entity
    assert_equal resolved_at, request.reload.resolved_at
  end

  test "authorization rejects other students and inaccessible contexts" do
    request = create_help_request

    as_user(@other_student) do
      patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "canceled" } }, headers: auth_headers
    end
    assert_response :not_found

    NotificationDeliveryService.help_request_created(request, push: false)
    request.acknowledge!(@staff)
    NotificationDeliveryService.help_request_changed(request, push: false)
    as_user(@student) do
      patch "/api/v1/help_requests/#{request.id}", params: { help_request: { status: "canceled" } }, headers: auth_headers
    end
    assert_response :success
    assert request.reload.status_canceled?
    assert Notification.find_by!(notifiable: request, user: @staff).read_at
    assert Notification.find_by!(notifiable: request, user: @student).read_at

    as_user(@other_student) do
      post "/api/v1/help_requests", params: {
        help_request: { cohort_id: @cohort.id, context_type: "lesson", context_id: @lesson.id, category: "concept", message: "No access" }
      }, headers: auth_headers
    end
    assert_response :forbidden
  end

  test "support queue is staff-only and combines requests with current student signals" do
    request = create_help_request(urgency: :urgent)
    Submission.create!(user: @student, content_block: @block, text: "Ready")

    as_user(@student) { get "/api/v1/support_queue", headers: auth_headers }
    assert_response :forbidden

    as_user(@staff) { get "/api/v1/support_queue", headers: auth_headers }
    assert_response :success
    queue = JSON.parse(response.body).fetch("support_queue")
    assert_equal request.id, queue.fetch("help_requests").first.fetch("id")
    student = queue.fetch("students").find { |item| item.fetch("user_id") == @student.id }
    assert_equal 1, student.fetch("urgent_help_count")
    assert_equal 1, student.fetch("ungraded_count")
  end

  private

  def create_help_request(urgency: :normal)
    HelpRequest.create!(
      student: @student,
      cohort: @cohort,
      context_type: :lesson,
      context_source: :primary,
      context_id: @lesson.id,
      context_label: @lesson.title,
      context_path: "/lessons/#{@lesson.id}",
      category: :concept,
      urgency: urgency,
      message: "I need a next step."
    )
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
