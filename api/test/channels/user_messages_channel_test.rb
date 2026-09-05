require "test_helper"

class UserMessagesChannelTest < ActionCable::Channel::TestCase
  def setup
    @user = User.create!(clerk_id: "typing_channel_user", email: "typing-channel@example.com", role: :student)
    stub_connection current_user: @user
    subscribe
  end

  test "throttles duplicate active typing events within the delivery window" do
    calls = []
    broadcaster = lambda do |**attributes|
      calls << attributes
      true
    end

    with_typing_broadcaster(broadcaster) do
      perform :typing, target_type: "channel", target_id: 12, active: true, thread_root_id: nil
      perform :typing, target_type: "channel", target_id: 12, active: true, thread_root_id: nil
    end

    assert_equal 1, calls.length
    assert_equal @user, calls.first.fetch(:user)
  end

  test "does not throttle a valid event after a rejected event" do
    calls = []
    outcomes = [ false, true ]
    broadcaster = lambda do |**attributes|
      calls << attributes
      outcomes.shift
    end

    with_typing_broadcaster(broadcaster) do
      perform :typing, target_type: "channel", target_id: -1, active: true, thread_root_id: nil
      perform :typing, target_type: "channel", target_id: 12, active: true, thread_root_id: nil
    end

    assert_equal 2, calls.length
    assert_equal [ -1, 12 ], calls.map { |attributes| attributes.fetch(:target_id) }
  end

  private

  def with_typing_broadcaster(broadcaster)
    original = MessageTypingBroadcastService.method(:call)
    MessageTypingBroadcastService.define_singleton_method(:call, broadcaster)
    yield
  ensure
    MessageTypingBroadcastService.define_singleton_method(:call, original)
  end
end
