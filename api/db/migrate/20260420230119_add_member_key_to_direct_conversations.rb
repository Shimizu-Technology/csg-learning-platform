class AddMemberKeyToDirectConversations < ActiveRecord::Migration[8.1]
  def up
    add_column :direct_conversations, :member_key, :string

    DirectConversation.reset_column_information
    DirectConversation.find_each do |conversation|
      member_key = DirectConversation.member_key_for(conversation.direct_conversation_members.pluck(:user_id))
      conversation.update_columns(member_key: member_key)
    end

    change_column_null :direct_conversations, :member_key, false
    add_index :direct_conversations, [ :cohort_id, :member_key ], unique: true, name: "idx_direct_conversations_member_key"
  end

  def down
    remove_index :direct_conversations, name: "idx_direct_conversations_member_key"
    remove_column :direct_conversations, :member_key
  end
end
