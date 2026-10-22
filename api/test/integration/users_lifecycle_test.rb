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
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @channel = Channel.create!(workspace: @cohort.workspace, cohort: @cohort, name: "Lifecycle Chat")
  end

  test "aborted archive update returns record errors with 422" do
    target_id = @instructor.id
    abort_archive = proc do |record|
      if record.id == target_id && record.will_save_change_to_archived_at?
        record.errors.add(:base, "Cannot remove the last active admin")
        throw :abort
      end
    end
    User.set_callback(:update, :before, abort_archive)

    as_user(@admin) { delete "/api/v1/users/#{target_id}", headers: auth_headers }

    assert_response :unprocessable_entity
    assert_equal [ "Cannot remove the last active admin" ], JSON.parse(response.body).fetch("errors")
    assert_not @instructor.reload.archived?
  ensure
    User.skip_callback(:update, :before, abort_archive) if abort_archive
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

  test "staff can request cohort-scoped enrollments for student discovery" do
    student = User.create!(
      clerk_id: "clerk_discovery_student",
      email: "discovery-student@example.com",
      first_name: "Discovery",
      last_name: "Student",
      role: :student
    )
    enrollment = Enrollment.create!(user: student, cohort: @cohort, status: :active)

    as_user(@instructor) do
      get "/api/v1/users", params: { role: "student", include_enrollments: true }, headers: auth_headers
    end

    assert_response :success
    payload = JSON.parse(response.body).fetch("users").find { |item| item.fetch("id") == student.id }
    assert_equal [ {
      "id" => enrollment.id,
      "cohort_id" => @cohort.id,
      "cohort_name" => @cohort.name,
      "cohort_status" => @cohort.status,
      "access_expires_at" => nil,
      "status" => "active",
      "enrolled_at" => enrollment.enrolled_at&.iso8601(3),
      "completed_at" => nil
    } ], payload.fetch("enrollments")
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

  test "archiving a user revokes browser and mobile push registrations" do
    user = User.create!(
      clerk_id: "clerk_push_revocation",
      email: "push-revocation@example.com",
      first_name: "Push",
      last_name: "Revocation",
      role: :student
    )
    user.mobile_push_tokens.create!(
      token: "ExpoPushToken[archived-device]",
      platform: "ios",
      last_seen_at: Time.current
    )
    user.push_subscriptions.create!(
      endpoint: "https://push.example.com/archived-device",
      p256dh: "p256dh-key",
      auth: "auth-key",
      last_seen_at: Time.current
    )

    user.archive!

    assert_empty user.mobile_push_tokens.reload
    assert_empty user.push_subscriptions.reload
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

  test "resend invite reports when the user accepts during dispatch" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "accepted-during-resend@example.com",
      role: :student
    )
    original_call = UserInvitationDispatchService.instance_method(:call)
    UserInvitationDispatchService.define_method(:call) do
      UserInvitationDispatchService::Result.new(status: "accepted", error: nil)
    end

    as_user(@admin) do
      post "/api/v1/users/#{invite.id}/resend_invite",
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_match "already signed in", JSON.parse(response.body).fetch("error")
  ensure
    UserInvitationDispatchService.define_method(:call, original_call) if original_call
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

  test "restoring an archived user retries an invitation skipped by the delivery job" do
    invite = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "archived-queued-restore@example.com",
      role: :instructor,
      invite_delivery_status: "queued",
      archived_at: Time.current
    )
    SendUserInviteEmailJob.perform_now(invite.id)
    assert_equal "failed", invite.reload.invite_delivery_status

    assert_enqueued_with(job: SendUserInviteEmailJob) do
      as_user(@admin) do
        patch "/api/v1/users/#{invite.id}/unarchive",
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :success
    assert_equal "queued", invite.reload.invite_delivery_status
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
    @cohort.cohort_instructor_assignments.create!(user: active_staff)

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

  test "user index reports each team invitation state for the Team page" do
    sent = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "team-sent@example.com", role: :instructor, invite_delivery_status: "sent", invite_sent_at: 2.days.ago)
    expired = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "team-expired@example.com", role: :admin, invite_delivery_status: "sent", invite_sent_at: 31.days.ago)
    failed = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "team-failed@example.com", role: :instructor, invite_delivery_status: "failed", invite_last_error: "Invite email delivery failed")
    accepted = User.create!(clerk_id: "clerk_team_accepted", email: "team-accepted@example.com", role: :instructor, invite_delivery_status: "accepted")

    as_user(@admin) do
      get "/api/v1/users", params: { role: "instructor" }, headers: auth_headers
    end
    assert_response :success
    users = JSON.parse(response.body).fetch("users").index_by { |user| user.fetch("id") }
    assert_equal "sent", users.fetch(sent.id).fetch("invite_state")
    assert_equal (sent.invite_sent_at + 30.days).as_json, users.fetch(sent.id).fetch("invite_expires_at")
    assert_equal "failed", users.fetch(failed.id).fetch("invite_state")
    assert_equal "Invite email delivery failed", users.fetch(failed.id).fetch("invite_last_error")
    assert_equal "accepted", users.fetch(accepted.id).fetch("invite_state")

    as_user(@admin) do
      get "/api/v1/users", params: { role: "admin" }, headers: auth_headers
    end
    admins = JSON.parse(response.body).fetch("users").index_by { |user| user.fetch("id") }
    assert_equal "expired", admins.fetch(expired.id).fetch("invite_state")
  end

  test "resending an expired invite queues a fresh one" do
    expired = User.create!(clerk_id: "pending_#{SecureRandom.uuid}", email: "team-resend-expired@example.com", role: :instructor, invite_delivery_status: "sent", invite_sent_at: 45.days.ago)
    original = ClerkInvitationService.instance_method(:configured?)
    ClerkInvitationService.define_method(:configured?) { false }

    as_user(@admin) do
      post "/api/v1/users/#{expired.id}/resend_invite", headers: auth_headers
    end

    assert_response :success
    invitation = JSON.parse(response.body).fetch("invitation")
    assert_equal "queued", invitation.fetch("status")
    assert_equal "queued", invitation.fetch("state")
    assert_enqueued_jobs 1, only: SendUserInviteEmailJob
  ensure
    ClerkInvitationService.define_method(:configured?, original) if original
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

    assert_response :forbidden
    body = JSON.parse(response.body)
    assert_equal "account_archived", body.fetch("code")
    assert_includes body.fetch("error"), "deactivated"
  end

  test "student lookup rejects existing staff including archived staff without role changes" do
    [ @admin, @instructor ].each do |target|
      as_user(@admin) do
        post "/api/v1/users", params: { email: "  #{target.email.upcase}  ", role: "student", skip_invite: true }, headers: auth_headers, as: :json
      end
      assert_response :conflict
      assert_equal "staff_account_exists", JSON.parse(response.body).fetch("code")
      assert_match "Team", JSON.parse(response.body).fetch("error")
      assert target.reload.staff?
    end
    archived_admin = User.create!(clerk_id: "clerk_archived_roster_admin", email: "archived-roster-admin@example.com", role: :admin, archived_at: Time.current)
    as_user(@admin) { post "/api/v1/users", params: { email: archived_admin.email, role: "student" }, headers: auth_headers, as: :json }
    assert_response :conflict
    assert archived_admin.reload.archived?
    assert archived_admin.admin?
    @instructor.archive!
    as_user(@admin) { post "/api/v1/users", params: { email: @instructor.email, role: "student" }, headers: auth_headers, as: :json }
    assert_response :conflict
    assert @instructor.reload.archived?
    assert @instructor.instructor?
    assert_not Enrollment.exists?(user: @instructor, cohort: @cohort)
  end

  test "student lookup restores without changing roles even if enrollment fails" do
    student = User.create!(clerk_id: "clerk_restored_student", email: "restored-student@example.com", role: :student, archived_at: Time.current)
    as_user(@admin) do
      post "/api/v1/users", params: { email: "  #{student.email.upcase} ", role: "student", skip_invite: true }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_not student.reload.archived?
    assert student.student?
    as_user(@admin) do
      post "/api/v1/cohorts/#{@cohort.id}/enrollments", params: { user_id: student.id }, headers: auth_headers, as: :json
      assert_response :created
      post "/api/v1/cohorts/#{@cohort.id}/enrollments", params: { user_id: student.id }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
    assert student.reload.student?
    assert @admin.reload.admin?
    assert @instructor.reload.instructor?
  end

  test "existing student promotion requires an explicit update not account creation" do
    student = User.create!(clerk_id: "clerk_promote_student", email: "promote-student@example.com", role: :student)
    as_user(@admin) { post "/api/v1/users", params: { email: student.email, role: "instructor" }, headers: auth_headers, as: :json }
    assert_response :conflict
    assert student.reload.student?
    as_user(@admin) { patch "/api/v1/users/#{student.id}", params: { role: "instructor" }, headers: auth_headers, as: :json }
    assert_response :success
    assert student.reload.instructor?
  end

  test "last accepted active admin cannot be demoted even with pending or archived admins" do
    User.create!(clerk_id: "pending_guard_admin", email: "pending-guard@example.com", role: :admin)
    User.create!(clerk_id: "clerk_archived_guard_admin", email: "archived-guard@example.com", role: :admin, archived_at: Time.current)
    as_user(@admin) { patch "/api/v1/users/#{@admin.id}", params: { role: "instructor", first_name: "Changed" }, headers: auth_headers, as: :json }
    assert_response :unprocessable_entity
    assert_match "last active admin", JSON.parse(response.body).fetch("errors").join
    assert @admin.reload.admin?
    assert_equal "Admin", @admin.first_name
  end

  test "an accepted second admin allows explicit demotion" do
    User.create!(clerk_id: "clerk_second_admin", email: "second-admin@example.com", role: :admin)
    as_user(@admin) { patch "/api/v1/users/#{@admin.id}", params: { role: "instructor" }, headers: auth_headers, as: :json }
    assert_response :success
    assert @admin.reload.instructor?
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
