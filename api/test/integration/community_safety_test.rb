require "test_helper"

class CommunitySafetyTest < ActionDispatch::IntegrationTest
  def setup
    curriculum = Curriculum.create!(name: "Safety Curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Safety Cohort", start_date: Date.current, status: :active)
    @channel = @cohort.channels.find_by!(name: "Class Chat")
    @student = User.create!(clerk_id: "safety_student", email: "safety-student@example.com", first_name: "Safety", last_name: "Student", role: :student)
    @classmate = User.create!(clerk_id: "safety_classmate", email: "safety-classmate@example.com", first_name: "Class", last_name: "Mate", role: :student)
    @outsider = User.create!(clerk_id: "safety_outsider", email: "safety-outsider@example.com", first_name: "Outside", last_name: "Student", role: :student)
    @admin = User.create!(clerk_id: "safety_admin", email: "safety-admin@example.com", first_name: "Safety", last_name: "Admin", role: :admin)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @classmate, cohort: @cohort, status: :active)
  end

  test "community policy must be accepted before posting" do
    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Before accepting" }, headers: auth_headers, as: :json
    end

    assert_response :forbidden
    assert_equal "community_terms_required", JSON.parse(response.body).fetch("code")

    as_user(@student) do
      post "/api/v1/community_policy/accept", params: { version: CommunityPolicy::VERSION, accepted: true }, headers: auth_headers, as: :json
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "After accepting" }, headers: auth_headers, as: :json
    end

    assert_response :created
    assert_equal "After accepting", Message.last.body
  end

  test "student can report a visible message and staff can resolve the report" do
    message = Message.create!(channel: @channel, author: @classmate, body: "Please review this")

    as_user(@student) do
      post "/api/v1/content_reports", params: { content_report: { message_id: message.id, reason: "inappropriate_content" } }, headers: auth_headers, as: :json
    end

    assert_response :created
    report = ContentReport.last
    assert_equal @classmate, report.reported_user
    assert report.status_pending?

    as_user(@admin) do
      patch "/api/v1/content_reports/#{report.id}", params: { content_report: { status: "actioned" } }, headers: auth_headers, as: :json
    end

    assert_response :success
    assert report.reload.status_actioned?
    assert_equal @admin, report.reviewed_by
    assert report.resolved_at.present?
  end

  test "blocking hides message content, prevents direct messages, and can be reversed" do
    [ @student, @classmate ].each do |user|
      user.update!(community_terms_version: CommunityPolicy::VERSION, community_terms_accepted_at: Time.current)
    end
    message = Message.create!(channel: @channel, author: @classmate, body: "Hidden after block")

    as_user(@student) do
      post "/api/v1/user_blocks", params: { blocked_user_id: @classmate.id }, headers: auth_headers, as: :json
      get "/api/v1/channels/#{@channel.id}", headers: auth_headers
    end

    assert_response :success
    hidden = JSON.parse(response.body).fetch("messages").find { |item| item.fetch("id") == message.id }
    assert hidden.fetch("blocked")
    assert_equal "", hidden.fetch("body")

    as_user(@student) do
      post "/api/v1/direct_conversations", params: { cohort_id: @cohort.id, user_ids: [ @classmate.id ] }, headers: auth_headers, as: :json
    end
    assert_response :forbidden

    as_user(@student) do
      delete "/api/v1/user_blocks/#{@classmate.id}", headers: auth_headers
    end
    assert_response :no_content
    assert_not UserBlock.exists?(blocker: @student, blocked_user: @classmate)
  end

  test "blocked users list orders equal-timestamp blocks deterministically by id descending" do
    tied_at = Time.utc(2026, 11, 18, 10, 0, 0)
    peers = 3.times.map do |index|
      peer = User.create!(clerk_id: "safety_tied_#{index}", email: "safety-tied-#{index}@example.com", first_name: "Peer", last_name: index.to_s, role: :student)
      Enrollment.create!(user: peer, cohort: @cohort, status: :active)
      peer
    end
    blocks = peers.map do |peer|
      block = UserBlock.create!(blocker: @student, blocked_user: peer)
      block.update_columns(created_at: tied_at, updated_at: tied_at)
      block
    end

    as_user(@student) { get "/api/v1/user_blocks", headers: auth_headers }
    assert_response :success
    assert_equal blocks.sort_by(&:id).reverse.map(&:blocked_user_id),
      JSON.parse(response.body).fetch("blocked_users").map { |entry| entry.fetch("id") }
  end

  test "blocking hides previously stored message notifications" do
    message = Message.create!(channel: @channel, author: @classmate, body: "Stored notification secret")
    notification = @student.notifications.create!(
      actor: @classmate,
      notifiable: message,
      notification_type: :message,
      title: "Classmate sent a message",
      body: message.body,
      path: "/messages/#{@channel.id}"
    )

    as_user(@student) do
      post "/api/v1/user_blocks", params: { blocked_user_id: @classmate.id }, headers: auth_headers, as: :json
      get "/api/v1/notifications", headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body)
    assert_empty payload.fetch("notifications")
    assert_equal 0, payload.fetch("unread_count")
    assert Notification.exists?(notification.id), "blocking must preserve the notification record"

    as_user(@student) do
      patch "/api/v1/notifications/#{notification.id}/read", headers: auth_headers
    end
    assert_response :not_found
  end

  test "student cannot block and enumerate a user outside a visible workspace" do
    as_user(@student) do
      post "/api/v1/user_blocks", params: { blocked_user_id: @outsider.id }, headers: auth_headers, as: :json
    end

    assert_response :forbidden
    assert_not UserBlock.exists?(blocker: @student, blocked_user: @outsider)
  end

  test "user reports are idempotent while open and can be filed again after resolution" do
    2.times do
      as_user(@student) do
        post "/api/v1/content_reports", params: { content_report: { reported_user_id: @classmate.id, reason: "safety_concern" } }, headers: auth_headers, as: :json
      end
      assert_response :created
    end
    assert_equal 1, ContentReport.where(reporter: @student, reported_user: @classmate).count

    report = ContentReport.last
    as_user(@admin) do
      patch "/api/v1/content_reports/#{report.id}", params: { content_report: { status: "dismissed" } }, headers: auth_headers, as: :json
    end
    assert_response :success

    as_user(@student) do
      post "/api/v1/content_reports", params: { content_report: { reported_user_id: @classmate.id, reason: "harassment" } }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_equal 2, ContentReport.where(reporter: @student, reported_user: @classmate).count
  end

  test "account deletion requests stay idempotent through processing and require a documented resolution" do
    2.times do
      as_user(@student) { post "/api/v1/data_deletion_requests", headers: auth_headers }
      assert_response :created
    end
    assert_equal 1, @student.data_deletion_requests.status_pending.count

    deletion_request = @student.data_deletion_requests.first
    as_user(@admin) do
      patch "/api/v1/data_deletion_requests/#{deletion_request.id}", params: { data_deletion_request: { status: "processing" } }, headers: auth_headers, as: :json
    end

    assert_response :success
    assert deletion_request.reload.status_processing?
    assert_equal @admin, deletion_request.resolved_by

    as_user(@student) { post "/api/v1/data_deletion_requests", headers: auth_headers }
    assert_response :created
    assert_equal deletion_request.id, JSON.parse(response.body).dig("data_deletion_request", "id")
    assert_equal 1, @student.data_deletion_requests.count

    as_user(@admin) do
      patch "/api/v1/data_deletion_requests/#{deletion_request.id}", params: { data_deletion_request: { status: "completed" } }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity

    as_user(@admin) do
      patch "/api/v1/data_deletion_requests/#{deletion_request.id}", params: { data_deletion_request: { status: "completed", retention_note: "Verified deletion completed; required academic record retained in anonymized form." } }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert deletion_request.reload.status_completed?
    assert deletion_request.resolved_at.present?

    as_user(@admin) do
      patch "/api/v1/data_deletion_requests/#{deletion_request.id}", params: { data_deletion_request: { status: "processing" } }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
  end

  test "only admins can list or update reported DM excerpts and deletion requests" do
    assigned = User.create!(clerk_id: "safety_assigned_teacher", email: "safety-assigned@example.com", role: :instructor)
    unrelated = User.create!(clerk_id: "safety_unrelated_teacher", email: "safety-unrelated@example.com", role: :instructor)
    @cohort.cohort_instructor_assignments.create!(user: assigned)
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @classmate ])
    message = Message.create!(direct_conversation: conversation, author: @classmate, body: "Private reported excerpt")
    as_user(@student) do
      post "/api/v1/content_reports", params: { content_report: { message_id: message.id, reason: "inappropriate_content" } }, headers: auth_headers, as: :json
    end
    assert_response :created
    report = ContentReport.last
    as_user(@student) { post "/api/v1/data_deletion_requests", headers: auth_headers, as: :json }
    assert_response :created
    request = DataDeletionRequest.last
    [ assigned, unrelated, @student ].each do |user|
      as_user(user) do
        get "/api/v1/content_reports", headers: auth_headers
        assert_response :forbidden
        refute_includes response.body, message.body
        patch "/api/v1/content_reports/#{report.id}", params: { content_report: { status: "actioned" } }, headers: auth_headers, as: :json
        assert_response :forbidden
        get "/api/v1/data_deletion_requests", headers: auth_headers
        assert_response :forbidden
        patch "/api/v1/data_deletion_requests/#{request.id}", params: { data_deletion_request: { status: "completed" } }, headers: auth_headers, as: :json
        assert_response :forbidden
      end
    end
    assert report.reload.status_pending?
    assert request.reload.status_pending?
    as_user(@admin) do
      get "/api/v1/content_reports", headers: auth_headers
      assert_response :success
      assert_includes response.body, message.body
      get "/api/v1/data_deletion_requests", headers: auth_headers
      assert_response :success
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
