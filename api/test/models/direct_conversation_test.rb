require_relative "../support/model_coverage"

class DirectConversationTest < ModelCoverageTestCase
  test "canonical member keys make creation idempotent and restore archived conversations" do
    assert_equal "1:2:3", DirectConversation.member_key_for([ "3", 2, 1, 2 ])
    enrollment
    first = conversation
    assert_equal first, DirectConversation.find_or_create_for!(workspace: course.workspace, users: [ staff, student, student ])
    first.update!(status: :archived)
    assert DirectConversation.find_or_create_for!(workspace: course.workspace, users: [ student, staff ]).active?
    assert_equal 2, first.direct_conversation_members.count
    assert first.visible_to?(student)
    assert_not first.visible_to?(person)
    assert_includes DirectConversation.visible_for(student), first
  end

  test "blocked members cannot post and destroy removes members messages and preferences" do
    enrollment
    assert conversation.can_post?(student)
    UserBlock.create!(blocker: staff, blocked_user: student)
    assert conversation.blocked_for?(student)
    assert_not conversation.can_post?(student)
    member_ids = conversation.direct_conversation_members.ids
    item = Message.create!(direct_conversation: conversation, author: student, body: "Direct")
    preference = MessagePreference.create!(user: student, target: conversation)
    conversation.destroy!
    assert_empty DirectConversationMember.where(id: member_ids)
    assert_not Message.exists?(item.id)
    assert_not MessagePreference.exists?(preference.id)
  end
end
