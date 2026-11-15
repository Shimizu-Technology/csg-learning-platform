require "test_helper"

# R-5: presence reaches only the staff allowed to see the student.
class PresenceChannelTest < ActionCable::Channel::TestCase
  setup do
    curriculum = Curriculum.create!(name: "Presence Curriculum")
    @cohort_a = Cohort.create!(curriculum: curriculum, name: "Presence A", start_date: Date.current, status: :active)
    @cohort_b = Cohort.create!(curriculum: curriculum, name: "Presence B", start_date: Date.current, status: :active)
    @admin = User.create!(clerk_id: "presence_admin", email: "presence-admin@example.com", role: :admin)
    @instructor_a = User.create!(clerk_id: "presence_instructor_a", email: "presence-instructor-a@example.com", role: :instructor)
    @instructor_b = User.create!(clerk_id: "presence_instructor_b", email: "presence-instructor-b@example.com", role: :instructor)
    @cohort_a.cohort_instructor_assignments.create!(user: @instructor_a)
    @cohort_b.cohort_instructor_assignments.create!(user: @instructor_b)
    @student = User.create!(clerk_id: "presence_student", email: "presence-student@example.com", role: :student)
    Enrollment.create!(user: @student, cohort: @cohort_a, status: :active)
  end

  test "an admin subscribes to the admin stream only" do
    stub_connection current_user: @admin
    subscribe

    assert subscription.confirmed?
    assert_equal [ PresenceChannel::ADMIN_STREAM ], subscription.streams
  end

  test "an instructor subscribes only to assigned cohorts" do
    @cohort_b.cohort_instructor_assignments.create!(user: @instructor_a)
    stub_connection current_user: @instructor_a
    subscribe

    assert subscription.confirmed?
    assert_equal [ PresenceChannel.cohort_stream(@cohort_a.id), PresenceChannel.cohort_stream(@cohort_b.id) ].sort,
      subscription.streams.sort
  end

  test "an instructor not assigned to cohort A does not stream it" do
    stub_connection current_user: @instructor_b
    subscribe

    assert subscription.confirmed?
    assert_equal [ PresenceChannel.cohort_stream(@cohort_b.id) ], subscription.streams
    assert_not_includes subscription.streams, PresenceChannel.cohort_stream(@cohort_a.id)
  end

  test "an instructor with no cohorts is confirmed with no streams" do
    loner = User.create!(clerk_id: "presence_instructor_none", email: "presence-instructor-none@example.com", role: :instructor)
    stub_connection current_user: loner
    subscribe

    assert subscription.confirmed?
    assert_empty subscription.streams
  end

  test "a student is rejected" do
    stub_connection current_user: @student
    subscribe

    assert subscription.rejected?
    assert_empty subscription.streams
  end

  test "an archived instructor is rejected" do
    @instructor_a.update_column(:archived_at, Time.current)
    stub_connection current_user: @instructor_a
    subscribe

    assert subscription.rejected?
  end

  test "the old global staff stream is no longer used" do
    [ @admin, @instructor_a, @instructor_b ].each do |user|
      stub_connection current_user: user
      subscribe

      assert_not_includes subscription.streams, "presence:staff"
    end
  end
end
