require "test_helper"

# R-5: a student's heartbeat goes to their cohorts' instructors and to admins.
class PresenceBroadcastServiceTest < ActiveSupport::TestCase
  include ActionCable::TestHelper

  setup do
    curriculum = Curriculum.create!(name: "Presence Broadcast Curriculum")
    @cohort_a = Cohort.create!(curriculum: curriculum, name: "Broadcast A", start_date: Date.current, status: :active)
    @cohort_b = Cohort.create!(curriculum: curriculum, name: "Broadcast B", start_date: Date.current, status: :active)
    @student = User.create!(clerk_id: "broadcast_student", email: "broadcast-student@example.com", role: :student,
      last_seen_at: Time.zone.parse("2026-11-15 09:30:00"))
    Enrollment.create!(user: @student, cohort: @cohort_a, status: :active)
  end

  test "a student in cohort A reaches cohort A and admins, not cohort B" do
    PresenceBroadcastService.user_seen(@student)

    assert_equal 1, broadcasts(PresenceChannel.cohort_stream(@cohort_a.id)).size
    assert_equal 1, broadcasts(PresenceChannel::ADMIN_STREAM).size
    assert_empty broadcasts(PresenceChannel.cohort_stream(@cohort_b.id))
    assert_empty broadcasts("presence:staff")
  end

  test "the payload shape is unchanged" do
    PresenceBroadcastService.user_seen(@student)

    payload = JSON.parse(broadcasts(PresenceChannel.cohort_stream(@cohort_a.id)).first)
    assert_equal({ "event" => "presence.updated", "user_id" => @student.id, "last_seen_at" => @student.last_seen_at.as_json }, payload)
    assert_equal payload, JSON.parse(broadcasts(PresenceChannel::ADMIN_STREAM).first)
  end

  test "a student in two cohorts reaches both" do
    Enrollment.create!(user: @student, cohort: @cohort_b, status: :active)

    PresenceBroadcastService.user_seen(@student)

    assert_equal 1, broadcasts(PresenceChannel.cohort_stream(@cohort_a.id)).size
    assert_equal 1, broadcasts(PresenceChannel.cohort_stream(@cohort_b.id)).size
    assert_equal 1, broadcasts(PresenceChannel::ADMIN_STREAM).size
  end

  test "a dropped enrollment still reaches its cohort, as the staff cohort list shows it" do
    @student.enrollments.update_all(status: Enrollment.statuses.fetch("dropped"))

    PresenceBroadcastService.user_seen(@student)

    assert_equal 1, broadcasts(PresenceChannel.cohort_stream(@cohort_a.id)).size
  end

  test "an archived user is not broadcast" do
    @student.update_column(:archived_at, Time.current)

    PresenceBroadcastService.user_seen(@student)

    assert_empty broadcasts(PresenceChannel.cohort_stream(@cohort_a.id))
    assert_empty broadcasts(PresenceChannel::ADMIN_STREAM)
  end

  test "a user with no enrollments is not broadcast" do
    staff = User.create!(clerk_id: "broadcast_staff", email: "broadcast-staff@example.com", role: :instructor, last_seen_at: Time.current)

    PresenceBroadcastService.user_seen(staff)

    assert_empty broadcasts(PresenceChannel::ADMIN_STREAM)
  end
end
