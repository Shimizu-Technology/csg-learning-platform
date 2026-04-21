require "test_helper"

class MessageBroadcastServiceTest < ActiveSupport::TestCase
  test "created broadcasts messages with stream urls enabled" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "broadcast_author", email: "broadcast-author@example.com", first_name: "Broadcast", last_name: "Author", role: :admin)
    message = Message.create!(channel: channel, author: author, body: "Streaming attachments")

    render_calls = []
    original_render = MessageJson.method(:render)
    MessageJson.define_singleton_method(:render) do |record, **kwargs|
      render_calls << [ record, kwargs ]
      { id: record.id }
    end

    original_broadcast = ChannelMessagesChannel.method(:broadcast_to)
    ChannelMessagesChannel.define_singleton_method(:broadcast_to) { |_target, _payload| nil }

    MessageBroadcastService.created(message)

    assert_equal 1, render_calls.size
    assert_equal message, render_calls.first[0]
    assert_equal true, render_calls.first[1][:stream_url]
  ensure
    ChannelMessagesChannel.define_singleton_method(:broadcast_to, original_broadcast) if defined?(original_broadcast) && original_broadcast
    MessageJson.define_singleton_method(:render, original_render)
  end
end
