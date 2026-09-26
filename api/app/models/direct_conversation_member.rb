class DirectConversationMember < ApplicationRecord
  belongs_to :direct_conversation
  belongs_to :user

  validates :user_id, uniqueness: { scope: :direct_conversation_id }

  def mark_read!(message = nil)
    with_lock do
      read_at = message&.created_at || Time.current
      update!(last_read_at: read_at) if last_read_at.nil? || last_read_at < read_at
    end
  end
end
