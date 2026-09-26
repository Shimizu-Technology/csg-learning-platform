require "test_helper"

class UserInvitationDispatchServiceTest < ActiveJob::TestCase
  test "deduplicates invitations while a recent delivery is queued" do
    user = pending_user("invite-deduplication@example.com")

    assert_enqueued_jobs 1, only: SendUserInviteEmailJob do
      first = UserInvitationDispatchService.new(user: user).call
      second = UserInvitationDispatchService.new(user: user).call

      assert_equal "queued", first.status
      assert_equal "queued", second.status
    end
  end

  test "allows a queued invitation to be retried after the deduplication window" do
    user = pending_user("invite-stale-queue@example.com")
    user.update_columns(
      invite_delivery_status: "queued",
      updated_at: UserInvitationDispatchService::QUEUE_DEDUPLICATION_WINDOW.ago - 1.second
    )

    assert_enqueued_with(job: SendUserInviteEmailJob) do
      result = UserInvitationDispatchService.new(user: user).call
      assert_equal "queued", result.status
    end
  end

  test "records Clerk invitation failures without enqueueing email delivery" do
    user = pending_user("invite-clerk-failure@example.com")
    clerk = Object.new
    clerk.define_singleton_method(:configured?) { true }
    clerk.define_singleton_method(:create_invitation) do |**|
      { success: false, error: "Clerk rejected the invitation" }
    end
    original_new = ClerkInvitationService.method(:new)
    ClerkInvitationService.define_singleton_method(:new) { clerk }

    assert_no_enqueued_jobs only: SendUserInviteEmailJob do
      result = UserInvitationDispatchService.new(user: user).call
      assert_equal "failed", result.status
    end

    assert_equal "failed", user.reload.invite_delivery_status
    assert_match "Clerk rejected", user.invite_last_error
  ensure
    ClerkInvitationService.define_singleton_method(:new, original_new) if original_new
  end

  private

  def pending_user(email)
    User.create!(
      clerk_id: "pending_#{SecureRandom.uuid}",
      email: email,
      role: :student
    )
  end
end
