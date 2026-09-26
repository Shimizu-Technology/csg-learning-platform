class DirectConversationMember < ApplicationRecord
  belongs_to :direct_conversation
  belongs_to :user
  belongs_to :last_read_message, class_name: "Message", optional: true

  validates :user_id, uniqueness: { scope: :direct_conversation_id }

  def mark_read!(message = nil)
    with_lock do
      read_at = message&.created_at || Time.current
      should_advance = last_read_at.nil? || last_read_at < read_at ||
        (last_read_at == read_at && message && last_read_message_id && last_read_message_id < message.id)
      update!(last_read_at: read_at, last_read_message: message) if should_advance
    end
  end
end
