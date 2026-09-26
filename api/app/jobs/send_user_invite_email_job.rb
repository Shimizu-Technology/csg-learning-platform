class SendUserInviteEmailJob < ApplicationJob
  queue_as :default
  retry_on StandardError, wait: :polynomially_longer, attempts: 3

  def perform(user_id, invited_by_user_id = nil, invitation_url = nil)
    user = User.find_by(id: user_id)
    return if user.blank? || user.email.blank?

    invited_by = invited_by_user_id.present? ? User.find_by(id: invited_by_user_id) : nil
    success = UserInviteEmailService.send_invite(user: user, invited_by: invited_by, invitation_url: invitation_url)

    if success
      update_delivery_if_pending(user, invite_delivery_status: "sent", invite_sent_at: Time.current, invite_last_error: nil)
      return
    end

    message = UserInviteEmailService.configured? ? "Invite email delivery failed" : "Invite email delivery is not configured"
    update_delivery_if_pending(user, invite_delivery_status: "failed", invite_last_error: message)
    raise "Failed to send invite email to #{user.email}" if UserInviteEmailService.configured?
  rescue StandardError => e
    update_delivery_if_pending(user, invite_delivery_status: "failed", invite_last_error: e.message.to_s.truncate(500)) if user
    raise
  end

  private

  def update_delivery_if_pending(user, **attributes)
    user.with_lock do
      user.reload
      user.update!(attributes) if user.invite_pending?
    end
  end
end
