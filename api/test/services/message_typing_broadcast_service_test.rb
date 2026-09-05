require "test_helper"

class MessageTypingBroadcastServiceTest < ActiveSupport::TestCase
  def setup
    curriculum = Curriculum.create!(name: "Typing curriculum")
    cohort = Cohort.create!(curriculum: curriculum, name: "Typing cohort", start_date: Date.current, status: :active)
    @channel = cohort.channels.find_by!(name: "Class Chat")
    @author = User.create!(clerk_id: "typing_author", email: "typing-author@example.com", first_name: "Typing", last_name: "Author", role: :student)
    @recipient = User.create!(clerk_id: "typing_recipient", email: "typing-recipient@example.com", first_name: "Typing", last_name: "Recipient", role: :student)
    @outsider = User.create!(clerk_id: "typing_outsider", email: "typing-outsider@example.com", role: :student)
    Enrollment.create!(user: @author, cohort: cohort, status: :active)
    Enrollment.create!(user: @recipient, cohort: cohort, status: :active)
  end

  test "broadcasts typing state only to other conversation recipients" do
    broadcasts = capture_broadcasts do
      assert MessageTypingBroadcastService.call(user: @author, target_type: "channel", target_id: @channel.id, active: true)
    end

    assert_equal [ @recipient ], broadcasts.map(&:first)
    assert_equal "typing", broadcasts.first.second.fetch(:event)
    assert_equal @channel.id, broadcasts.first.second.fetch(:channel_id)
    assert_nil broadcasts.first.second.fetch(:direct_conversation_id)
    assert_equal true, broadcasts.first.second.fetch(:active)
    assert_equal @author.id, broadcasts.first.second.dig(:user, :id)
    assert_nil broadcasts.first.second.dig(:user, :email)
  end

  test "rejects inaccessible destinations and invalid thread roots" do
    root = Message.create!(channel: @channel, author: @author, body: "Root")

    broadcasts = capture_broadcasts do
      assert_not MessageTypingBroadcastService.call(user: @outsider, target_type: "channel", target_id: @channel.id, active: true)
      assert_not MessageTypingBroadcastService.call(user: @author, target_type: "channel", target_id: @channel.id, active: true, thread_root_id: root.id + 10_000)
      assert_not MessageTypingBroadcastService.call(user: @author, target_type: "channel", target_id: @channel.id, active: "true")
    end

    assert_empty broadcasts
  end

  test "includes a verified thread root and broadcasts stopped state" do
    root = Message.create!(channel: @channel, author: @author, body: "Root")

    broadcasts = capture_broadcasts do
      assert MessageTypingBroadcastService.call(user: @author, target_type: "channel", target_id: @channel.id, active: false, thread_root_id: root.id)
    end

    assert_equal false, broadcasts.first.second.fetch(:active)
    assert_equal root.id, broadcasts.first.second.fetch(:thread_root_id)
  end

  test "broadcasts direct-message typing state only to the other participants" do
    conversation = DirectConversation.find_or_create_for!(
      workspace: @channel.workspace,
      users: [ @author, @recipient ]
    )

    broadcasts = capture_broadcasts do
      assert MessageTypingBroadcastService.call(
        user: @author,
        target_type: "dm",
        target_id: conversation.id,
        active: true
      )
    end

    assert_equal [ @recipient ], broadcasts.map(&:first)
    assert_equal "typing", broadcasts.first.second.fetch(:event)
    assert_nil broadcasts.first.second.fetch(:channel_id)
    assert_equal conversation.id, broadcasts.first.second.fetch(:direct_conversation_id)
    assert_equal true, broadcasts.first.second.fetch(:active)
    assert_equal @author.id, broadcasts.first.second.dig(:user, :id)
    assert_nil broadcasts.first.second.dig(:user, :email)
  end

  private

  def capture_broadcasts
    broadcasts = []
    original = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |user, payload| broadcasts << [ user, payload ] }
    yield
    broadcasts
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original) if original
  end
end
