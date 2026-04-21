class DirectConversationMember < ApplicationRecord
  belongs_to :direct_conversation
  belongs_to :user

  validates :user_id, uniqueness: { scope: :direct_conversation_id }

  def mark_read!(message = nil)
    update!(
      last_read_at: Time.current
    )
  end
end
