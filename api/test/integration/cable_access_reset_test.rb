require "test_helper"

# R-5 fix round 1: every endpoint that changes a user's role, archive state or
# cohort assignments closes that user's cable connections after commit.
class CableAccessResetTest < ActionDispatch::IntegrationTest
  include ActionCable::TestHelper

  setup do
    @admin = User.create!(clerk_id: "cable_reset_admin", email: "cable-reset-admin@example.com", role: :admin)
    @instructor = User.create!(clerk_id: "cable_reset_instructor", email: "cable-reset-instructor@example.com", role: :instructor)
    curriculum = Curriculum.create!(name: "Cable Reset Curriculum")
    @cohort = Cohort.create!(curriculum: curriculum, name: "Cable Reset Cohort", start_date: Date.current, status: :active)
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    ActionCable.server.pubsub.clear
  end

  test "changing a role on the team page disconnects with reconnect" do
    as_user(@admin) { patch "/api/v1/users/#{@instructor.id}", params: { role: "student" }, headers: auth_headers }

    assert_response :success
    assert_equal [ disconnect(reconnect: true) ], internal_broadcasts(@instructor)
  end

  test "archiving disconnects without reconnect and restoring disconnects again" do
    as_user(@admin) { delete "/api/v1/users/#{@instructor.id}", headers: auth_headers }
    assert_response :success
    assert_equal [ disconnect(reconnect: false) ], internal_broadcasts(@instructor)

    as_user(@admin) { patch "/api/v1/users/#{@instructor.id}/unarchive", headers: auth_headers }
    assert_response :success
    assert_equal [ disconnect(reconnect: false), disconnect(reconnect: true) ], internal_broadcasts(@instructor)
  end

  test "assigning and removing an instructor disconnects that instructor" do
    other = User.create!(clerk_id: "cable_reset_other", email: "cable-reset-other@example.com", role: :instructor)

    as_user(@admin) { post "/api/v1/cohorts/#{@cohort.id}/instructor_assignments", params: { user_id: other.id }, headers: auth_headers }
    assert_response :created
    assert_equal [ disconnect(reconnect: true) ], internal_broadcasts(other)

    as_user(@admin) { delete "/api/v1/cohorts/#{@cohort.id}/instructor_assignments/#{@instructor.id}", headers: auth_headers }
    assert_response :no_content
    assert_equal [ disconnect(reconnect: true) ], internal_broadcasts(@instructor)
  end

  test "profile edits and rolled-back changes leave connections open" do
    as_user(@admin) { patch "/api/v1/users/#{@instructor.id}", params: { first_name: "Renamed" }, headers: auth_headers }
    assert_response :success

    # The last accepted admin cannot be demoted; the rollback must not disconnect.
    as_user(@admin) { patch "/api/v1/users/#{@admin.id}", params: { role: "instructor" }, headers: auth_headers }
    assert_response :unprocessable_entity

    assert_empty internal_broadcasts(@instructor)
    assert_empty internal_broadcasts(@admin)
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test-token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end

  def internal_broadcasts(user)
    ActionCable.server.pubsub.broadcasts("action_cable/#{user.to_gid_param}").map { |payload| JSON.parse(payload) }
  end

  def disconnect(reconnect:)
    { "type" => "disconnect", "reconnect" => reconnect }
  end
end
