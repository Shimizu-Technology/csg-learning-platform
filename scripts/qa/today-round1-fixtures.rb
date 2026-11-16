require_relative 'boot'
UserBlock.find_or_create_by!(blocker_id: 3, blocked_user_id: 2)
HelpRequest.first.update!(urgency: :urgent)
Intervention.first.update!(next_follow_up_at: 1.day.ago)

DirectConversationMember.where(user_id: 2).update_all(last_read_at: nil, last_read_message_id: nil)
