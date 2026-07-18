class MessageMentionEmailJob < ApplicationJob
  queue_as :default

  def perform(message_id, mentioned_user_ids, skip_user_ids = [])
    return if mentioned_user_ids.blank?

    message = Message.includes(:author, :channel, :direct_conversation).find_by(id: message_id)
    return unless message
    return if message.deleted?

    User.not_archived.where(id: mentioned_user_ids).where.not(id: Array(skip_user_ids)).find_each do |user|
      next unless user.message_email_notifications_enabled?

      NotificationEmailService.send_message_mention(user: user, message: message)
    end
  end
end
