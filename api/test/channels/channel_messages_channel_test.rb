require "test_helper"

class ChannelMessagesChannelTest < ActionCable::Channel::TestCase
  setup do
    @curriculum = Curriculum.create!(name: "Cable Self-Paced")
    @instructor = User.create!(clerk_id: "cable_sp_instructor", email: "cable-sp-inst@example.com", role: :instructor)
    @learner = User.create!(clerk_id: "cable_sp_learner", email: "cable-sp-learner@example.com", role: :student)
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Cable Python",
      start_date: Date.current,
      status: :active,
      course_delivery: "self_paced"
    )
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @cohort.update!(support_instructor: @instructor)
    @channel = @cohort.channels.find_by!(name: "Class Chat")
    @staff_channel = @cohort.channels.create!(name: "Staff Only", visibility: :staff_only)
    @enrollment = Enrollment.create!(user: @learner, cohort: @cohort, status: :active, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now)
  end

  test "rejects self-paced learner subscription until peer space is enabled for both school and cohort" do
    stub_connection current_user: @learner
    subscribe channel_id: @channel.id
    assert subscription.rejected?

    SchoolSetting.current.update!(features: { "self_paced_peer_space" => true })
    subscribe channel_id: @channel.id
    assert subscription.rejected?

    @cohort.update!(settings: { "features" => { "self_paced_peer_space" => true } })
    subscribe channel_id: @channel.id
    assert subscription.confirmed?
    assert_has_stream_for @channel
  end

  test "rejects staff-only channel and paused or expired self-paced enrollments even when peer space is on" do
    SchoolSetting.current.update!(features: { "self_paced_peer_space" => true })
    @cohort.update!(settings: { "features" => { "self_paced_peer_space" => true } })

    stub_connection current_user: @learner
    subscribe channel_id: @staff_channel.id
    assert subscription.rejected?

    @enrollment.update!(status: :paused)
    subscribe channel_id: @channel.id
    assert subscription.rejected?

    @enrollment.update!(status: :active, access_expires_at: 1.minute.ago)
    subscribe channel_id: @channel.id
    assert subscription.rejected?
  end
end
