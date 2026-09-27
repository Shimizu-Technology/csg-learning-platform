class AddLastReadMessageToDirectConversationMembers < ActiveRecord::Migration[8.1]
  def change
    add_reference :direct_conversation_members, :last_read_message, foreign_key: { to_table: :messages }, index: true
  end
end
