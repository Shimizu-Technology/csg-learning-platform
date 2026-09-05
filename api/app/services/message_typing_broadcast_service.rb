class MessageTypingBroadcastService
  class << self
    def call(user:, target_type:, target_id:, active:, thread_root_id: nil)
      return false unless active == true || active == false

      target = find_target(target_type, target_id)
      return false unless target&.can_post?(user)

      normalized_thread_root_id = normalize_thread_root_id(target, thread_root_id)
      return false if thread_root_id.present? && normalized_thread_root_id.nil?

      payload = {
        event: "typing",
        channel_id: target.is_a?(Channel) ? target.id : nil,
        direct_conversation_id: target.is_a?(DirectConversation) ? target.id : nil,
        thread_root_id: normalized_thread_root_id,
        active: active,
        user: {
          id: user.id,
          full_name: user.full_name,
          avatar_url: user.avatar_url
        }
      }

      target.recipients.where.not(id: user.id).find_each do |recipient|
        UserMessagesChannel.broadcast_to(recipient, payload)
      end
      true
    end

    private

    def find_target(target_type, target_id)
      id = Integer(target_id, exception: false)
      return nil unless id&.positive?

      case target_type
      when "channel" then Channel.find_by(id: id)
      when "dm" then DirectConversation.find_by(id: id)
      end
    end

    def normalize_thread_root_id(target, thread_root_id)
      return nil if thread_root_id.blank?

      id = Integer(thread_root_id, exception: false)
      return nil unless id&.positive?

      target.messages.visible.where(id: id, parent_message_id: nil).pick(:id)
    end
  end
end
