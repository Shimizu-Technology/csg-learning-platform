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
    assert_database_rejects other, { name: channel.name }, ActiveRecord::RecordNotUnique, constraint: "index_channels_on_workspace_id_and_name"
    assert_operator Channel.ordered.to_a.index(channel), :<, Channel.ordered.to_a.index(other)
    sample_message
    state = ChannelReadState.create!(channel: channel, user: student)
    preference = MessagePreference.create!(user: student, target: channel)
    channel.destroy!
    assert_not Message.exists?(sample_message.id)
    assert_not ChannelReadState.exists?(state.id)
    assert_not MessagePreference.exists?(preference.id)
  end

  test "self paced peer space requires both switches active enrollment and active support to post" do
    instructor = User.create!(clerk_id: "channel_sp_instructor", email: "channel-sp-instructor@example.com", role: :instructor)
    course.cohort_instructor_assignments.create!(user: instructor)
    course.update!(course_delivery: "self_paced", support_instructor: instructor)
    enrollment.update!(first_opened_at: Time.current, support_expires_at: 2.weeks.from_now)

    assert_not Channel.self_paced_peer_space_enabled?(course)
    assert_not channel.visible_to?(student)
    assert_not channel.can_post?(student)

    SchoolSetting.current.update!(features: { "self_paced_peer_space" => true })
    assert_not Channel.self_paced_peer_space_enabled?(course)
    assert_not channel.visible_to?(student)

    course.update!(settings: { "features" => { "self_paced_peer_space" => true } })
    channel.reload
    assert Channel.self_paced_peer_space_enabled?(course)
    assert channel.visible_to?(student)
    assert channel.can_post?(student)
    assert_nil channel.post_disabled_reason(student)

    enrollment.update!(support_expires_at: nil)
    assert channel.visible_to?(student)
    assert_not channel.can_post?(student)
    assert_match(/Open Today or a lesson/, channel.post_disabled_reason(student))

    enrollment.update!(support_expires_at: 1.minute.ago)
    assert channel.visible_to?(student)
    assert_not channel.can_post?(student)
    assert_match(/support period has ended/i, channel.post_disabled_reason(student))

    course.update!(settings: { "features" => { "self_paced_peer_space" => true, "class_channels" => false } })
    channel.reload
    assert_not Channel.self_paced_peer_space_enabled?(course)
    assert_not channel.visible_to?(student)
  end
end
