require "test_helper"

class ChannelsTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp 2026")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current, status: :active)
    @channel = @cohort.channels.find_by!(name: "Class Chat")

    @student = User.create!(clerk_id: "clerk_student", email: "student@example.com", first_name: "Student", last_name: "One", role: :student)
    @other_student = User.create!(clerk_id: "clerk_other", email: "other@example.com", first_name: "Student", last_name: "Two", role: :student)
    @admin = User.create!(clerk_id: "clerk_admin", email: "admin@example.com", first_name: "Admin", last_name: "User", role: :admin)

    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @other_student, cohort: @other_cohort, status: :active)
  end

  test "cohort creation creates default class chat channel" do
    assert_equal "Class Chat", @channel.name
    assert @channel.cohort?
    assert @channel.active?
  end

  test "student only sees channels for enrolled cohorts" do
    as_user(@student) do
      get "/api/v1/channels", headers: auth_headers
    end

    assert_response :success
    channels = JSON.parse(response.body).fetch("channels")
    assert_equal [ @channel.id ], channels.map { |channel| channel.fetch("id") }
  end

  test "unenrolled student cannot read channel" do
    as_user(@other_student) do
      get "/api/v1/channels/#{@channel.id}", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "student posts message and creates notification for classmates and staff" do
    second_student = User.create!(clerk_id: "clerk_second", email: "second@example.com", role: :student)
    Enrollment.create!(user: second_student, cohort: @cohort, status: :active)

    assert_enqueued_with(job: PushNotificationJob) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Can someone share the Zoom link?" },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    message = Message.last
    assert_equal @student, message.author
    assert_equal "Can someone share the Zoom link?", message.body
    assert_equal 0, @student.notifications.message.count
    assert_equal 1, second_student.notifications.message.unread.count
    assert_equal 1, @admin.notifications.message.unread.count
  end

  test "student post persists mention user ids" do
    second_student = User.create!(clerk_id: "clerk_mention_second", email: "mention-second@example.com", first_name: "Second", last_name: "Student", role: :student)
    Enrollment.create!(user: second_student, cohort: @cohort, status: :active)

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "@Second Student can you help?", mention_user_ids: [ second_student.id ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    body = JSON.parse(response.body)
    assert_equal [ second_student.id ], body.dig("message", "mention_user_ids")
    assert_equal [ second_student.id ], Message.last.mention_user_ids
  end

  test "mark read clears channel message notifications only" do
    message = Message.create!(channel: @channel, author: @admin, body: "Welcome to chat")
    NotificationDeliveryService.message_created(message)

    as_user(@student) do
      patch "/api/v1/channels/#{@channel.id}/read", headers: auth_headers
    end

    assert_response :success
    assert_equal 0, @student.notifications.message.unread.count
    state = @student.channel_read_states.find_by!(channel: @channel)
    assert_equal message, state.last_read_message
  end

  test "student cannot post to staff-only channel" do
    staff_channel = @cohort.channels.create!(name: "Staff Room", visibility: :staff_only)

    as_user(@student) do
      post "/api/v1/channels/#{staff_channel.id}/messages",
        params: { body: "Hello?" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
  end

  test "staff cannot post to archived channel" do
    @channel.update!(status: :archived)

    as_user(@admin) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Is this still open?" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
  end

  test "student cannot edit or delete messages after losing channel access" do
    message = Message.create!(channel: @channel, author: @student, body: "Before access changed")
    @student.enrollments.find_by!(cohort: @cohort).update!(status: :dropped)

    as_user(@student) do
      patch "/api/v1/messages/#{message.id}",
        params: { body: "After access changed" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
    assert_equal "Before access changed", message.reload.body

    as_user(@student) do
      delete "/api/v1/messages/#{message.id}", headers: auth_headers
    end

    assert_response :forbidden
    assert_nil message.reload.deleted_at
  end

  test "cable token is short lived and single use" do
    as_user(@student) do
      post "/api/v1/cable_token", headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert body.fetch("token").present?
    assert_equal CableToken::EXPIRES_IN.to_i, body.fetch("expires_in")

    assert_equal @student, CableToken.consume(body.fetch("token"))
    assert_nil CableToken.consume(body.fetch("token"))
  end

  test "expired cable tokens are rejected" do
    as_user(@student) do
      post "/api/v1/cable_token", headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)

    travel 2.minutes do
      assert_nil CableToken.consume(body.fetch("token"))
    end
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = {
      "sub" => user.clerk_id,
      "email" => user.email,
      "first_name" => user.first_name,
      "last_name" => user.last_name
    }

    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
