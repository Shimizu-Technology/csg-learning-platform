require "test_helper"

class SelfPacedPeerSpaceTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper
  include ActionCable::TestHelper

  setup do
    @curriculum = Curriculum.create!(name: "Self-Paced Python")
    @instructor = user("sp_instructor", :instructor, first: "Guide", last: "Teacher")
    @admin = user("sp_admin", :admin, first: "School", last: "Admin")
    @cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Python Self-Paced",
      start_date: Date.current,
      status: :active,
      course_delivery: "self_paced"
    )
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @cohort.update!(support_instructor: @instructor)
    @channel = @cohort.channels.find_by!(name: "Class Chat")
    @staff_channel = @cohort.channels.create!(name: "Staff Room", visibility: :staff_only)

    @other_cohort = Cohort.create!(
      curriculum: @curriculum,
      name: "Other Self-Paced",
      start_date: Date.current,
      status: :active,
      course_delivery: "self_paced"
    )
    @other_cohort.cohort_instructor_assignments.create!(user: @instructor)
    @other_cohort.update!(support_instructor: @instructor)

    @learner = user("sp_learner", :student, first: "Alex", last: "Learner")
    @peer = user("sp_peer", :student, first: "Jamie", last: "Peer")
    @paused_learner = user("sp_paused", :student, first: "Pat", last: "Paused")
    @expired_learner = user("sp_expired", :student, first: "Morgan", last: "Expired")
    @dropped_learner = user("sp_dropped", :student, first: "Casey", last: "Dropped")
    @completed_learner = user("sp_completed", :student, first: "Riley", last: "Done")
    @outsider = user("sp_outsider", :student, first: "Taylor", last: "Outside")

    @enrollment = Enrollment.create!(user: @learner, cohort: @cohort, status: :active, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now, access_expires_at: 6.months.from_now)
    @peer_enrollment = Enrollment.create!(user: @peer, cohort: @cohort, status: :active, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now, access_expires_at: 6.months.from_now)
    Enrollment.create!(user: @paused_learner, cohort: @cohort, status: :paused, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now, access_expires_at: 6.months.from_now)
    Enrollment.create!(user: @expired_learner, cohort: @cohort, status: :active, first_opened_at: 2.months.ago, support_expires_at: 1.month.ago, access_expires_at: 1.day.ago)
    Enrollment.create!(user: @dropped_learner, cohort: @cohort, status: :dropped, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now, access_expires_at: 6.months.from_now)
    Enrollment.create!(user: @completed_learner, cohort: @cohort, status: :completed, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now, access_expires_at: 6.months.from_now)
    Enrollment.create!(user: @outsider, cohort: @other_cohort, status: :active, first_opened_at: Time.current, support_expires_at: 2.weeks.from_now, access_expires_at: 6.months.from_now)
  end

  test "off self-paced cohort hides channels workspace members and notifications" do
    Message.create!(channel: @channel, author: @instructor, body: "Hidden channel note")

    [
      [ {}, {} ],
      [ { "self_paced_peer_space" => true }, {} ],
      [ { "self_paced_peer_space" => true }, { "self_paced_peer_space" => false } ],
      [ { "self_paced_peer_space" => false }, { "self_paced_peer_space" => true } ],
      [ { "self_paced_peer_space" => true }, { "self_paced_peer_space" => true, "class_channels" => false } ]
    ].each do |school_features, cohort_features|
      SchoolSetting.current.update!(features: school_features)
      @cohort.update!(settings: { "features" => cohort_features })

      as_user(@learner) do
        get "/api/v1/channels", headers: auth_headers
        assert_response :success
        assert_empty response.parsed_body.fetch("channels")

        get "/api/v1/channels/#{@channel.id}", headers: auth_headers
        assert_response :forbidden

        post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Should fail" }, headers: auth_headers, as: :json
        assert_response :forbidden

        get "/api/v1/workspaces/#{@cohort.workspace.id}", headers: auth_headers
        assert_response :success
        assert_equal 0, response.parsed_body.dig("workspace", "member_count")
        assert_empty response.parsed_body.dig("workspace", "members")

        get "/api/v1/messages/search", params: { q: "Hidden channel" }, headers: auth_headers
        assert_response :success
        assert_empty response.parsed_body.fetch("results")

        post "/api/v1/user_blocks", params: { blocked_user_id: @peer.id }, headers: auth_headers, as: :json
        assert_response :forbidden
      end

      refute_includes @channel.recipients.reorder(nil).pluck(:id), @learner.id
    end
  end

  test "opted-in self-paced cohort opens cohort channels for active learners while blocking classmate DMs and staff-only channels" do
    enable_peer_space!(@cohort)

    as_user(@learner) do
      get "/api/v1/channels", headers: auth_headers
      assert_response :success
      channels = response.parsed_body.fetch("channels")
      assert_equal [ @channel.id ], channels.map { |c| c.fetch("id") }
      assert_equal true, channels.sole.fetch("can_post")
      assert_nil channels.sole.fetch("post_disabled_reason")

      get "/api/v1/channels/#{@staff_channel.id}", headers: auth_headers
      assert_response :forbidden

      post "/api/v1/channels/#{@staff_channel.id}/messages", params: { body: "Peek" }, headers: auth_headers, as: :json
      assert_response :forbidden

      get "/api/v1/workspaces/#{@cohort.workspace.id}", headers: auth_headers
      assert_response :success
      assert_equal 2, response.parsed_body.dig("workspace", "member_count")
      member_ids = response.parsed_body.dig("workspace", "members").map { |m| m.fetch("id") }
      assert_equal [ @learner.id, @peer.id ].sort, member_ids.sort

      # Classmate DMs remain strictly blocked; instructor DM stays available.
      get "/api/v1/direct_conversations/available_users", params: { workspace_id: @cohort.workspace.id }, headers: auth_headers
      assert_response :success
      assert_equal [ @instructor.id ], response.parsed_body.fetch("users").map { |u| u.fetch("id") }

      post "/api/v1/direct_conversations", params: { workspace_id: @cohort.workspace.id, user_ids: [ @peer.id ] }, headers: auth_headers, as: :json
      assert_response :not_found

      post "/api/v1/direct_conversations", params: { workspace_id: @cohort.workspace.id, user_ids: [ @instructor.id ] }, headers: auth_headers, as: :json
      assert_response :created
    end
  end

  test "opted-in self-paced learners can post reply react mention search and receive notifications" do
    enable_peer_space!(@cohort)

    as_user(@learner) do
      assert_enqueued_with(job: PushNotificationJob) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Hey @Jamie Peer, how did you solve lesson 2?", mention_user_ids: [ @peer.id, @outsider.id ] },
          headers: auth_headers,
          as: :json
      end
      assert_response :created
    end

    root = Message.last
    assert_equal [ @peer.id ], root.mention_user_ids
    assert_equal 1, @peer.notifications.message.unread.count
    assert_equal 1, @instructor.notifications.message.unread.count
    assert_equal 1, @admin.notifications.message.unread.count
    assert_equal 0, @paused_learner.notifications.message.count
    assert_equal 0, @expired_learner.notifications.message.count
    assert_equal 0, @dropped_learner.notifications.message.count
    assert_equal 0, @completed_learner.notifications.message.count
    assert_equal 0, @outsider.notifications.message.count

    as_user(@peer) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "I used a loop!", parent_message_id: root.id },
        headers: auth_headers,
        as: :json
      assert_response :created

      post "/api/v1/messages/#{root.id}/reactions", params: { emoji: "thumbs_up" }, headers: auth_headers, as: :json
      assert_response :success

      get "/api/v1/messages/#{root.id}/thread", headers: auth_headers
      assert_response :success
      assert_equal 1, response.parsed_body.fetch("replies").size

      get "/api/v1/messages/search", params: { q: "solve lesson 2" }, headers: auth_headers
      assert_response :success
      assert_equal [ root.id ], response.parsed_body.fetch("results").map { |r| r.fetch("id") }
    end
  end

  test "paused expired dropped completed and other-cohort learners stay excluded when peer space is on" do
    enable_peer_space!(@cohort)
    Message.create!(channel: @channel, author: @learner, body: "Active community message")

    [ @paused_learner, @expired_learner, @dropped_learner, @completed_learner, @outsider ].each do |excluded|
      as_user(excluded) do
        get "/api/v1/channels", headers: auth_headers
        assert_response :success
        refute_includes response.parsed_body.fetch("channels").map { |c| c.fetch("id") }, @channel.id

        get "/api/v1/channels/#{@channel.id}", headers: auth_headers
        assert_response :forbidden

        post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Blocked" }, headers: auth_headers, as: :json
        assert_response :forbidden
      end

      refute @channel.visible_to?(excluded)
      refute @channel.can_post?(excluded)
    end
  end

  test "support expiry keeps course channel readable while disabling posting with a clear reason" do
    enable_peer_space!(@cohort)
    Message.create!(channel: @channel, author: @peer, body: "Helpful thread")
    @enrollment.update!(support_expires_at: 1.minute.ago)

    as_user(@learner) do
      get "/api/v1/channels/#{@channel.id}", headers: auth_headers
      assert_response :success
      assert_equal false, response.parsed_body.dig("channel", "can_post")
      assert_match(/support period has ended/i, response.parsed_body.dig("channel", "post_disabled_reason"))
      assert_equal [ "Helpful thread" ], response.parsed_body.fetch("messages").map { |m| m.fetch("body") }

      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Late post" }, headers: auth_headers, as: :json
      assert_response :forbidden
    end
  end

  test "user blocks work between peers in an opted-in peer space and hide blocked text" do
    enable_peer_space!(@cohort)

    as_user(@learner) do
      post "/api/v1/user_blocks", params: { blocked_user_id: @peer.id }, headers: auth_headers, as: :json
      assert_response :created
    end

    as_user(@peer) do
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Secret blocked text" }, headers: auth_headers, as: :json
      assert_response :created
    end

    assert_equal 0, @learner.notifications.message.count

    as_user(@learner) do
      get "/api/v1/channels/#{@channel.id}", headers: auth_headers
      assert_response :success
      msg = response.parsed_body.fetch("messages").last
      assert_equal true, msg.fetch("blocked")
      assert_equal "", msg.fetch("body")
    end
  end

  test "turning peer space off immediately hides prior channel notifications" do
    enable_peer_space!(@cohort)
    as_user(@peer) do
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Check this out" }, headers: auth_headers, as: :json
      assert_response :created
    end
    assert_equal 1, @learner.notifications.visible_to(@learner).message.count

    @cohort.update!(settings: { "features" => { "self_paced_peer_space" => false } })
    assert_equal 0, @learner.notifications.visible_to(@learner).message.count
  end

  private

  def enable_peer_space!(cohort)
    SchoolSetting.current.update!(features: { "self_paced_peer_space" => true })
    cohort.update!(settings: { "features" => { "self_paced_peer_space" => true } })
  end

  def user(clerk_id, role, first:, last:)
    User.create!(
      clerk_id: clerk_id,
      email: "#{clerk_id}@example.com",
      first_name: first,
      last_name: last,
      role: role,
      community_terms_version: CommunityPolicy::VERSION,
      community_terms_accepted_at: Time.current
    )
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
