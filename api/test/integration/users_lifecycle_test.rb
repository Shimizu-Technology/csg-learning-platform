require "test_helper"

class UsersLifecycleTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  setup do
    clear_enqueued_jobs
    @admin = User.create!(
      clerk_id: "clerk_users_lifecycle_admin",
      email: "users-lifecycle-admin@example.com",
      first_name: "Admin",
      last_name: "User",
      role: :admin
    )
    @instructor = User.create!(
      clerk_id: "clerk_users_lifecycle_instructor",
      email: "users-lifecycle-instructor@example.com",
      first_name: "Instructor",
      last_name: "User",
      role: :instructor
    )
    @curriculum = Curriculum.create!(name: "Lifecycle Curriculum")
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Lifecycle Cohort",
      start_date: Date.current,
      status: :active
    )
    @channel = Channel.create!(workspace: @cohort.workspace, cohort: @cohort, name: "Lifecycle Chat")
  end

  test "admin deletes an unused pending invite" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "pending-delete@example.com",
      first_name: "Pending",
      last_name: "Invite",
      role: :instructor
    )

    as_user(@admin) do
      delete "/api/v1/users/#{invite.id}", headers: auth_headers
    end

    assert_response :success
    assert_equal "deleted", JSON.parse(response.body).fetch("action")
    assert_nil User.find_by(id: invite.id)
  end

  test "admin archives pending invite with enrollment instead of hard deleting it" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "pending-enrolled@example.com",
      first_name: "Pending",
      last_name: "Enrolled",
      role: :student
    )
    enrollment = Enrollment.create!(user: invite, cohort: @cohort, status: :active)

    as_user(@admin) do
      delete "/api/v1/users/#{invite.id}", headers: auth_headers
    end

    assert_response :success
    assert_equal "archived", JSON.parse(response.body).fetch("action")
    assert invite.reload.archived?
    assert_equal invite.id, enrollment.reload.user_id
  end

  test "admin archives a user with authored message history instead of hard deleting" do
    duplicate = User.create!(
      clerk_id: "clerk_duplicate_staff",
      email: "duplicate-staff@example.com",
      first_name: "Duplicate",
      last_name: "Staff",
      role: :admin
    )
    message = Message.create!(channel: @channel, author: duplicate, body: "Keep my history")
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @admin, duplicate ])
    Message.create!(direct_conversation: conversation, author: duplicate, body: "Historical DM")
    announcement = Announcement.create!(
      title: "Historical notice",
      body: "Keep the author record",
      author: duplicate,
      audience: :cohort,
      cohort: @cohort,
      status: :published
    )

    as_user(@admin) do
      delete "/api/v1/users/#{duplicate.id}", headers: auth_headers
    end

    assert_response :success
    assert_equal "archived", JSON.parse(response.body).fetch("action")
    assert duplicate.reload.archived?
    assert conversation.reload.archived?
    assert_equal duplicate.id, message.reload.author_id
    assert_equal duplicate.id, announcement.reload.author_id
  end

  test "archiving an already archived user is idempotent" do
    duplicate = User.create!(
      clerk_id: "clerk_archived_duplicate_staff",
      email: "archived-duplicate-staff@example.com",
      first_name: "Archived",
      last_name: "Duplicate",
      role: :admin
    )
    Message.create!(channel: @channel, author: duplicate, body: "Keep my history")

    as_user(@admin) do
      delete "/api/v1/users/#{duplicate.id}", headers: auth_headers
    end

    assert_response :success
    archived_at = duplicate.reload.archived_at
    assert archived_at.present?

    as_user(@admin) do
      delete "/api/v1/users/#{duplicate.id}", headers: auth_headers
    end

    assert_response :success
    assert_equal "archived", JSON.parse(response.body).fetch("action")
    assert_equal archived_at, duplicate.reload.archived_at
  end

  test "creating an archived pending invite reactivates and sends a fresh invite" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "archived-pending-reactivate@example.com",
      first_name: "Archived",
      last_name: "Invite",
      role: :instructor,
      archived_at: Time.current
    )

    assert_enqueued_with(job: SendUserInviteEmailJob) do
      as_user(@admin) do
        post "/api/v1/users",
          params: { email: invite.email, role: "instructor" },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    assert_nil invite.reload.archived_at
  end

  test "resend invite is blocked for archived pending users" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "archived-pending-resend@example.com",
      first_name: "Archived",
      last_name: "Resend",
      role: :instructor,
      archived_at: Time.current
    )

    assert_no_enqueued_jobs only: SendUserInviteEmailJob do
      as_user(@admin) do
        post "/api/v1/users/#{invite.id}/resend_invite",
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :unprocessable_entity
    assert_match "Archived users", JSON.parse(response.body).fetch("error")
  end

  test "admin can restore an archived user" do
    archived_staff = User.create!(
      clerk_id: "clerk_archived_restore_staff",
      email: "archived-restore-staff@example.com",
      first_name: "Archived",
      last_name: "Restore",
      role: :instructor,
      archived_at: Time.current
    )

    as_user(@admin) do
      patch "/api/v1/users/#{archived_staff.id}/unarchive",
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    assert_nil archived_staff.reload.archived_at
    assert_nil JSON.parse(response.body).fetch("user").fetch("archived_at")
  end

  test "restoring an archived pending invite sends a fresh invite" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "archived-pending-restore@example.com",
      first_name: "Archived",
      last_name: "Pending Restore",
      role: :instructor,
      archived_at: Time.current
    )

    assert_enqueued_with(job: SendUserInviteEmailJob) do
      as_user(@admin) do
        patch "/api/v1/users/#{invite.id}/unarchive",
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :success
    assert_nil invite.reload.archived_at
  end

  test "archived users are hidden from default user and direct message candidate lists" do
    archived_staff = User.create!(
      clerk_id: "clerk_archived_staff",
      email: "archived-staff@example.com",
      first_name: "Archived",
      last_name: "Staff",
      role: :instructor,
      archived_at: Time.current
    )
    active_staff = User.create!(
      clerk_id: "clerk_active_staff",
      email: "active-staff@example.com",
      first_name: "Active",
      last_name: "Staff",
      role: :instructor
    )

    as_user(@admin) do
      get "/api/v1/users", headers: auth_headers
    end

    assert_response :success
    user_ids = JSON.parse(response.body).fetch("users").map { |user| user.fetch("id") }
    assert_includes user_ids, active_staff.id
    refute_includes user_ids, archived_staff.id

    as_user(@admin) do
      get "/api/v1/direct_conversations/available_users",
        params: { workspace_id: @cohort.workspace.id },
        headers: auth_headers
    end

    assert_response :success
    available_ids = JSON.parse(response.body).fetch("users").map { |user| user.fetch("id") }
    assert_includes available_ids, active_staff.id
    refute_includes available_ids, archived_staff.id
  end

  test "only admins can include archived users in user index" do
    archived_staff = User.create!(
      clerk_id: "clerk_archived_staff_index",
      email: "archived-staff-index@example.com",
      first_name: "Archived",
      last_name: "Staff",
      role: :instructor,
      archived_at: Time.current
    )

    as_user(@instructor) do
      get "/api/v1/users",
        params: { include_archived: true },
        headers: auth_headers
    end

    assert_response :forbidden

    as_user(@admin) do
      get "/api/v1/users",
        params: { include_archived: true },
        headers: auth_headers
    end

    assert_response :success
    user_ids = JSON.parse(response.body).fetch("users").map { |user| user.fetch("id") }
    assert_includes user_ids, archived_staff.id
  end

  test "archived users cannot authenticate" do
    archived_user = User.create!(
      clerk_id: "clerk_archived_auth",
      email: "archived-auth@example.com",
      first_name: "Archived",
      last_name: "Auth",
      role: :student,
      archived_at: Time.current
    )

    as_user(archived_user) do
      post "/api/v1/sessions", headers: auth_headers
    end

    assert_response :unauthorized
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test-token" }
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
end
