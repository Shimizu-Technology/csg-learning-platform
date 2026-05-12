class MessageMentionEmailJob < ApplicationJob
  queue_as :default

  def perform(message_id, mentioned_user_ids)
    return if mentioned_user_ids.blank?

    message = Message.includes(:author, :channel, :direct_conversation).find_by(id: message_id)
    return unless message
    return if message.deleted?

    User.not_archived.where(id: mentioned_user_ids).find_each do |user|
      NotificationEmailService.send_message_mention(user: user, message: message)
    end
  end
end
