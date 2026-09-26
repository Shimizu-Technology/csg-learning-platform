class DirectConversationMember < ApplicationRecord
  belongs_to :direct_conversation
  belongs_to :user
  belongs_to :last_read_message, class_name: "Message", optional: true

  validates :user_id, uniqueness: { scope: :direct_conversation_id }

  def mark_read!(message = nil)
    with_lock do
      read_at = message&.created_at || Time.current
      update!(last_read_at: read_at, last_read_message: message) if MessageReadCursor.advances?(self, read_at, message)
    end
  end
end
