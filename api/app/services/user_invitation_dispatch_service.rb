class UserInvitationDispatchService
  QUEUE_DEDUPLICATION_WINDOW = 10.minutes
  Result = Data.define(:status, :error)

  def initialize(user:, invited_by: nil)
    @user = user
    @invited_by = invited_by
  end

  def call
    return Result.new(status: "not_needed", error: nil) unless @user.invite_pending?

    @user.with_lock do
      @user.reload
      return Result.new(status: "accepted", error: nil) unless @user.invite_pending?
      if @user.invite_delivery_status == "queued" && @user.updated_at >= QUEUE_DEDUPLICATION_WINDOW.ago
        return Result.new(status: "queued", error: nil)
      end

      @user.update!(invite_delivery_status: "queued", invite_last_error: nil)
    end
    invitation_url = clerk_invitation_url
    SendUserInviteEmailJob.perform_later(@user.id, @invited_by&.id, invitation_url)
    Result.new(status: "queued", error: nil)
  rescue StandardError => e
    record_failure(e.message)
    Result.new(status: "failed", error: "The account was saved, but the invitation could not be queued. Retry the invitation from the cohort roster.")
  end

  private

  def clerk_invitation_url
    clerk = ClerkInvitationService.new
    return nil unless clerk.configured?

    result = clerk.create_invitation(
      email: @user.email,
      redirect_url: FrontendUrlResolver.resolve,
      ignore_existing: true
    )
    return result[:url] if result[:success]

    Rails.logger.warn("[InviteDispatch] clerk_invitation_failed recipient_user_id=#{@user.id}")
    raise(result[:error].presence || "Clerk invitation creation failed")
  end

  def record_failure(message)
    @user.with_lock do
      @user.reload
      return unless @user.invite_pending?

      @user.update_columns(
        invite_delivery_status: "failed",
        invite_last_error: message.to_s.truncate(500),
        updated_at: Time.current
      )
    end
  rescue StandardError
    nil
  end
end
