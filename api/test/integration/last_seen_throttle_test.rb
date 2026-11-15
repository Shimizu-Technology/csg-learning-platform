require "test_helper"
require_relative "../support/query_counter"

# R-3: authenticated requests write users.last_seen_at at most once per
# User::LAST_SEEN_WRITE_INTERVAL, in one conditional UPDATE. The web presence
# heartbeat still records "now" so staff presence stays live.
class LastSeenThrottleTest < ActionDispatch::IntegrationTest
  include QueryCounter
  include ActionCable::TestHelper

  setup do
    @user = User.create!(clerk_id: "seen_learner", email: "seen-learner@example.com", first_name: "Seen", last_name: "Learner", role: :student)
    request_as(@user) { post "/api/v1/sessions", headers: auth_headers } # attach the Clerk identity
  end

  test "a request inside the window writes nothing" do
    recent = 20.seconds.ago.change(usec: 0)
    @user.update_column(:last_seen_at, recent)

    queries = capture_queries { request_as(@user) { get "/api/v1/notifications", headers: auth_headers } }

    assert_response :success
    assert_equal recent, @user.reload.last_seen_at
    assert_empty queries.grep(/\AUPDATE "users"/), "No users write inside the window"
    assert_empty queries.grep(/LOWER\("users"."email"\)/), "An unchanged profile is not re-validated"
  end

  test "a request after the window records the time once" do
    @user.update_column(:last_seen_at, (User::LAST_SEEN_WRITE_INTERVAL + 5.seconds).ago)
    updated_at = @user.reload.updated_at

    queries = capture_queries { request_as(@user) { post "/api/v1/sessions", headers: auth_headers } }

    assert_response :success
    assert_in_delta Time.current, @user.reload.last_seen_at, 5
    assert_equal 1, queries.grep(/\AUPDATE "users" SET "last_seen_at"/).size
    assert_equal updated_at, @user.updated_at, "Activity is not a profile edit"
    assert_in_delta Time.current, Time.zone.parse(response.parsed_body.dig("user", "last_seen_at")), 5, "The session payload shows the new time"
  end

  test "a user never seen before is recorded on the first request" do
    @user.update_column(:last_seen_at, nil)

    request_as(@user) { get "/api/v1/notifications", headers: auth_headers }

    assert_response :success
    assert_in_delta Time.current, @user.reload.last_seen_at, 5
  end

  test "profile changes from the token still save" do
    @user.update_column(:last_seen_at, 10.seconds.ago)

    request_as(@user, first_name: "Renamed") { get "/api/v1/notifications", headers: auth_headers }

    assert_response :success
    assert_equal "Renamed", @user.reload.first_name
  end

  test "the presence heartbeat records now even inside the window and broadcasts it" do
    @user.update_column(:last_seen_at, 20.seconds.ago)

    queries = nil
    assert_broadcasts("presence:staff", 1) do
      queries = capture_queries { request_as(@user) { post "/api/v1/presence", headers: auth_headers } }
    end

    assert_response :success
    assert_in_delta Time.current, @user.reload.last_seen_at, 5
    assert_equal 1, queries.grep(/\AUPDATE "users"/).size
    assert_in_delta Time.current, Time.zone.parse(response.parsed_body.fetch("last_seen_at")), 5
  end

  test "the presence heartbeat writes once when authentication already recorded the visit" do
    @user.update_column(:last_seen_at, 10.minutes.ago)

    queries = capture_queries { request_as(@user) { post "/api/v1/presence", headers: auth_headers } }

    assert_response :success
    assert_equal 1, queries.grep(/\AUPDATE "users"/).size
    assert_in_delta Time.current, @user.reload.last_seen_at, 5
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def request_as(user, first_name: user.first_name)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
