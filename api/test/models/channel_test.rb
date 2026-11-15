require_relative "../support/model_coverage"

class ChannelTest < ModelCoverageTestCase
  test "visibility and posting distinguish enrolled paused archived and staff users" do
    enrollment
    assert channel.visible_to?(student)
    assert channel.can_post?(student)
    assert_includes Channel.visible_for(student), channel
    assert_not channel.visible_to?(person)
    assert_empty Channel.visible_for(nil)
    enrollment.update!(status: :paused)
    assert_not channel.can_post?(student)
    assert_not Channel.visible_for(student).exists?(channel.id)
    enrollment.update!(status: :active)
    channel.update!(visibility: :staff_only)
    assert_not channel.visible_to?(student)
    assert channel.visible_to?(staff)
    channel.update!(status: :archived)
    assert_not channel.can_post?(staff)
  end

  test "workspace synchronization uniqueness ordering and destroy dependencies" do
    assert_equal course.id, channel.cohort_id
    assert_invalid channel.dup, :name, channel.name
    other = Channel.create!(workspace: course.workspace, name: "Other", position: 10)
    assert_database_rejects other, { name: channel.name }, ActiveRecord::RecordNotUnique
    assert_operator Channel.ordered.to_a.index(channel), :<, Channel.ordered.to_a.index(other)
    sample_message
    state = ChannelReadState.create!(channel: channel, user: student)
    preference = MessagePreference.create!(user: student, target: channel)
    channel.destroy!
    assert_not Message.exists?(sample_message.id)
    assert_not ChannelReadState.exists?(state.id)
    assert_not MessagePreference.exists?(preference.id)
  end
end
