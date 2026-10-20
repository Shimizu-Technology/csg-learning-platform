require "test_helper"

class UserInviteStateTest < ActiveSupport::TestCase
  def pending_user(**attributes)
    User.create!({
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: "invite-state-#{SecureRandom.hex(4)}@example.com",
      role: :instructor
    }.merge(attributes))
  end

  test "a signed-in user is accepted" do
    user = User.create!(clerk_id: "user_invite_state_accepted", email: "invite-state-accepted@example.com", role: :instructor, invite_delivery_status: "accepted")

    assert_equal "accepted", user.invite_state
    assert_nil user.invite_expires_at
  end

  test "pending delivery states pass through unchanged" do
    %w[not_sent queued failed].each do |status|
      assert_equal status, pending_user(invite_delivery_status: status).invite_state
    end
  end

  test "a sent invitation expires with the Clerk invitation link" do
    sent_at = Time.zone.parse("2026-10-01 09:00")
    user = pending_user(invite_delivery_status: "sent", invite_sent_at: sent_at)

    assert_equal sent_at + 30.days, user.invite_expires_at
    assert_equal "sent", user.invite_state(now: sent_at + 29.days)
    assert_equal "expired", user.invite_state(now: sent_at + 30.days)
  end

  test "a sent invitation without a timestamp stays sent" do
    user = pending_user(invite_delivery_status: "sent", invite_sent_at: nil)

    assert_nil user.invite_expires_at
    assert_equal "sent", user.invite_state
  end

  test "a failed or unsent invitation never reads as expired" do
    user = pending_user(invite_delivery_status: "failed", invite_sent_at: 60.days.ago)

    assert_nil user.invite_expires_at
    assert_equal "failed", user.invite_state
  end

  test "a pending account with a stale accepted status can be invited again" do
    assert_equal "not_sent", pending_user(invite_delivery_status: "accepted").invite_state
  end
end
