require "test_helper"

class SendUserInviteEmailJobTest < ActiveJob::TestCase
  test "records successful invitation delivery" do
    user = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "invite-success@example.com",
      role: :student,
      invite_delivery_status: "queued"
    )

    with_invite_service(send_invite: true) do
      SendUserInviteEmailJob.perform_now(user.id)
    end

    assert_equal "sent", user.reload.invite_delivery_status
    assert user.invite_sent_at.present?
    assert_nil user.invite_last_error
  end

  test "records an unavailable invitation provider as a retryable failure" do
    user = User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "invite-unconfigured@example.com",
      role: :student,
      invite_delivery_status: "queued"
    )

    with_invite_service(send_invite: false, configured: false) do
      SendUserInviteEmailJob.perform_now(user.id)
    end

    assert_equal "failed", user.reload.invite_delivery_status
    assert_match "not configured", user.invite_last_error
  end

  test "does not overwrite accepted status when delivery finishes after sign-in" do
    user = User.create!(
      clerk_id: "clerk_accepted",
      email: "already-accepted@example.com",
      role: :student,
      invite_delivery_status: "accepted"
    )

    with_invite_service(send_invite: true) do
      SendUserInviteEmailJob.perform_now(user.id)
    end

    assert_equal "accepted", user.reload.invite_delivery_status
    assert_nil user.invite_sent_at
  end

  private

  def with_invite_service(send_invite:, configured: nil)
    original_send_invite = UserInviteEmailService.method(:send_invite)
    original_configured = UserInviteEmailService.method(:configured?)
    UserInviteEmailService.define_singleton_method(:send_invite) { |**| send_invite }
    UserInviteEmailService.define_singleton_method(:configured?) { configured } unless configured.nil?
    yield
  ensure
    UserInviteEmailService.define_singleton_method(:send_invite, original_send_invite)
    UserInviteEmailService.define_singleton_method(:configured?, original_configured)
  end
end
