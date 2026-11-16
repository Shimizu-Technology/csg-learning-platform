require "test_helper"
require_relative "../support/job_adapter_helpers"

class UserInvitationDispatchServiceTest < ActiveJob::TestCase
  include JobAdapterHelpers
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
    assert_equal "RuntimeError", user.invite_last_error
  ensure
    ClerkInvitationService.define_singleton_method(:new, original_new) if original_new
  end

  test "records an enqueue failure instead of leaving the invitation queued" do
    user = pending_user("invite-enqueue-failure@example.com")
    original_perform_later = SendUserInviteEmailJob.method(:perform_later)
    SendUserInviteEmailJob.define_singleton_method(:perform_later) { |*| false }

    result = UserInvitationDispatchService.new(user: user).call

    assert_equal "failed", result.status
    assert_equal "failed", user.reload.invite_delivery_status
    assert_equal "RuntimeError", user.invite_last_error
  ensure
    SendUserInviteEmailJob.define_singleton_method(:perform_later, original_perform_later) if original_perform_later
  end

  test "recent inline delivery is deduplicated and failed delivery can retry" do
    user = pending_user("inline-dedup@example.test")
    user.update!(invite_delivery_status: "sent", invite_sent_at: Time.current)
    assert_no_enqueued_jobs do
      assert_equal "sent", UserInvitationDispatchService.new(user: user).call.status
    end
    user.update!(invite_delivery_status: "failed")
    assert_enqueued_jobs 1 do
      assert_equal "queued", UserInvitationDispatchService.new(user: user).call.status
    end
  end

  [ :inline, :test ].each do |adapter_name|
    test "dispatch uses the effective #{adapter_name} adapter for delivery and provider failures" do
      adapter = ActiveJob::QueueAdapters.lookup(adapter_name).new
      # Deliberately disagree with the effective adapter: TestHelper can do
      # exactly this, so neither dispatch nor failure isolation can use the name.
      original_adapter = SendUserInviteEmailJob._queue_adapter
      original_name = SendUserInviteEmailJob._queue_adapter_name
      SendUserInviteEmailJob.queue_adapter = adapter_name == :inline ? :test : :inline
      original_send = UserInviteEmailService.method(:send_invite)
      original_configured = UserInviteEmailService.method(:configured?)
      UserInviteEmailService.define_singleton_method(:configured?) { true }
      calls = []
      UserInviteEmailService.define_singleton_method(:send_invite) do |user:, **|
        calls << user.id
        raise IOError, "provider failure" if user.email.start_with?("failure")
        true
      end

      with_job_adapter(SendUserInviteEmailJob, adapter) do
        ApplicationJob.enqueue_within_transaction do
          [ "success", "failure" ].each do |outcome|
            user = pending_user("#{outcome}-#{adapter_name}@example.test")
            result = UserInvitationDispatchService.new(user: user).call
            expected = outcome == "success" ? "sent" : "failed"
            if adapter_name == :test
              assert_equal "queued", result.status
              refute_includes calls, user.id
              payload = adapter.enqueued_jobs.shift
              assert_equal SendUserInviteEmailJob, payload[:job]
              ActiveJob::Base.execute(payload)
            else
              assert_equal expected, result.status
            end
            assert_includes calls, user.id
            assert_equal expected, user.reload.invite_delivery_status
            assert_equal "IOError", user.invite_last_error if outcome == "failure"
          end
        end
        if adapter_name == :test
          assert_equal 1, adapter.enqueued_jobs.size, "queued delivery retains its provider retry"
          assert_equal 1, adapter.enqueued_jobs.first["executions"]
        end
      end
    ensure
      SendUserInviteEmailJob._queue_adapter = original_adapter
      SendUserInviteEmailJob._queue_adapter_name = original_name
      UserInviteEmailService.define_singleton_method(:send_invite, original_send) if original_send
      UserInviteEmailService.define_singleton_method(:configured?, original_configured) if original_configured
    end
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
