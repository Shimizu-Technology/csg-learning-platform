require "test_helper"

class AgentPostingTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  ENDPOINT = "/api/v1/agent/messages".freeze

  def setup
    Api::V1::Agent::MessagesController::RATE_LIMIT_STORE.clear
    @curriculum = Curriculum.create!(name: "Agent curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Agent cohort", start_date: Date.current, status: :active)
    @channel = @cohort.channels.find_by!(name: "Class Chat")
    @admin = user("owner", :admin)
    @other_admin = user("otheradmin", :admin)
    @student = user("student", :student)
    @classmate = user("classmate", :student)
    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @classmate, cohort: @cohort, status: :active)
    @conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @admin, @student ])
    @record, @token = AgentPostingToken.issue!(user: @admin, name: "Home base")
  end

  test "posts a DM as the owner with audit columns, normal delivery and normalized Markdown" do
    broadcasts = capture_user_broadcasts do
      assert_difference("Message.count", 1) do
        post_agent(direct_conversation_id: @conversation.id, body: "**Reminder**\r\n\r\n- bring laptop\r\n")
      end
    end

    assert_response :created
    assert_equal "no-store", response.headers["Cache-Control"]
    message = Message.find(data.dig("message", "id"))
    assert_equal @admin, message.author
    assert_equal @record, message.agent_posting_token
    assert_equal "Home base", message.sent_via_label
    assert_equal "**Reminder**\n\n- bring laptop\n", message.body
    assert_equal "agent-#{@record.id}:retry-key-0001", message.client_message_id
    assert message.delivery_tracking_requested?
    assert message.broadcasts_delivered_at?
    assert message.notifications_delivered_at?
    assert @record.reload.last_used_at
    assert_equal %w[body channel_id created_at direct_conversation_id id sent_via_label thread_root_id], data.fetch("message").keys.sort

    student_payloads = broadcasts.select { |target, _payload| target == @student }.map(&:last)
    created = student_payloads.find { |payload| payload.with_indifferent_access[:event] == "created" }
    assert created, "recipient must receive the same realtime event as a human-sent message"
    assert_equal "Home base", created.with_indifferent_access.dig(:message, :sent_via_label)
    assert Notification.where(user: @student, notifiable: message).exists?, "recipient gets the normal DM notification"

    get "/api/v1/direct_conversations", headers: clerk_headers(@student)
    assert_response :success
    summary = data.fetch("direct_conversations").find { |conversation| conversation.fetch("id") == @conversation.id }
    assert_equal 1, summary.fetch("unread_count")

    get "/api/v1/direct_conversations/#{@conversation.id}", headers: clerk_headers(@student)
    assert_equal "Home base", data.fetch("messages").last.fetch("sent_via_label")
    assert_not data.fetch("messages").last.key?("client_message_id")
  end

  test "posts to a channel and replies in a thread" do
    root = @channel.messages.create!(author: @student, body: "Question about loops")

    post_agent(channel_id: @channel.id, body: "Channel note", key: "channel-0001")
    assert_response :created
    assert_equal @channel.id, data.dig("message", "channel_id")

    post_agent(channel_id: @channel.id, body: "Thread answer", thread_root_id: root.id, key: "thread-0001")
    assert_response :created
    reply = Message.find(data.dig("message", "id"))
    assert_equal root, reply.parent_message
    assert_equal root.id, data.dig("message", "thread_root_id")
    assert reply.thread_broadcasts_delivered_at?

    nested = @channel.messages.create!(author: @student, body: "Nested", parent_message: root)
    post_agent(channel_id: @channel.id, body: "Too deep", thread_root_id: nested.id, key: "thread-0002")
    assert_response :unprocessable_entity
    other_root = @conversation.messages.create!(author: @student, body: "DM root")
    post_agent(channel_id: @channel.id, body: "Wrong place", thread_root_id: other_root.id, key: "thread-0003")
    assert_response :unprocessable_entity
    post_agent(channel_id: @channel.id, body: "Bad root", thread_root_id: "abc", key: "thread-0004")
    assert_response :unprocessable_entity
    assert_equal 0, Message.where(body: "Bad root").count
  end

  test "posts to an existing one-to-one DM by recipient user id but never creates conversations" do
    post_agent(recipient_user_id: @student.id, body: "By recipient", key: "recipient-0001")
    assert_response :created
    assert_equal @conversation.id, data.dig("message", "direct_conversation_id")

    assert_no_difference("DirectConversation.count") do
      post_agent(recipient_user_id: @classmate.id, body: "No DM yet", key: "recipient-0002")
    end
    assert_response :not_found

    post_agent(recipient_user_id: @admin.id, body: "Self", key: "recipient-0003")
    assert_response :not_found

    community = Workspace.create!(name: "Agent community", slug: "agent-community", workspace_type: :community)
    [ @admin, @student ].each { |member| community.workspace_memberships.create!(user: member) }
    second = DirectConversation.find_or_create_for!(workspace: community, users: [ @admin, @student ])
    post_agent(recipient_user_id: @student.id, body: "Ambiguous", key: "recipient-0004")
    assert_response :unprocessable_entity
    assert_equal "workspace_required", data.fetch("code")
    post_agent(recipient_user_id: @student.id, workspace_id: community.id, body: "Community", key: "recipient-0005")
    assert_response :created
    assert_equal second.id, data.dig("message", "direct_conversation_id")
  end

  test "retries with the same idempotency key post once and conflicting reuse is rejected" do
    broadcasts = capture_user_broadcasts do
      post_agent(direct_conversation_id: @conversation.id, body: "Only once\r\n", key: "same-key-0001")
      assert_response :created
      first_id = data.dig("message", "id")
      count = broadcasts_so_far.length

      assert_no_difference([ "Message.count", "Notification.count" ]) do
        post_agent(direct_conversation_id: @conversation.id, body: "Only once\r\n", key: "same-key-0001")
      end
      assert_response :ok
      assert_equal first_id, data.dig("message", "id")
      assert_equal count, broadcasts_so_far.length, "replays must not re-broadcast"

      post_agent(direct_conversation_id: @conversation.id, body: "Different", key: "same-key-0001")
      assert_response :conflict
    end
    assert_operator broadcasts.length, :>, 0

    post "#{ENDPOINT}?idempotency_key=field-key-0001", params: { direct_conversation_id: @conversation.id, body: "Field key" }, headers: { "Authorization" => "Bearer #{@token}" }, as: :json
    assert_response :created

    [ nil, "short", "has spaces in it", "x" * 65 ].each do |bad_key|
      post ENDPOINT, params: { direct_conversation_id: @conversation.id, body: "No key" }, headers: { "Authorization" => "Bearer #{@token}", "Idempotency-Key" => bad_key }.compact, as: :json
      assert_response :unprocessable_entity
      assert_equal "idempotency_key_required", data.fetch("code")
    end

    # Keys are namespaced per token, so another token reusing a key posts its own message.
    _other, other_token = AgentPostingToken.issue!(user: @admin, name: "Second assistant")
    assert_difference("Message.count", 1) do
      post ENDPOINT, params: { direct_conversation_id: @conversation.id, body: "Only once\r\n" }, headers: { "Authorization" => "Bearer #{other_token}", "Idempotency-Key" => "same-key-0001" }, as: :json
    end
    assert_response :created
  end

  test "destinations the owner cannot post to are rejected by the normal authorization" do
    peer_dm = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @classmate ])
    post_agent(direct_conversation_id: peer_dm.id, body: "Not a member")
    assert_response :forbidden

    archived = @cohort.channels.create!(name: "Old channel", status: :archived)
    post_agent(channel_id: archived.id, body: "Archived", key: "archived-0001")
    assert_response :forbidden

    UserBlock.create!(blocker: @student, blocked_user: @admin)
    post_agent(direct_conversation_id: @conversation.id, body: "Blocked", key: "blocked-0001")
    assert_response :forbidden

    post_agent(channel_id: 0, body: "Missing", key: "missing-0001")
    assert_response :not_found
    post_agent(body: "No destination", key: "none-0001")
    assert_response :unprocessable_entity
    post_agent(channel_id: @channel.id, direct_conversation_id: peer_dm.id, body: "Two destinations", key: "two-0001")
    assert_response :unprocessable_entity
    post_agent(channel_id: @channel.id, body: "", key: "blank-0001")
    assert_response :unprocessable_entity
    post_agent(channel_id: @channel.id, body: "x" * 5001, key: "long-0001")
    assert_response :unprocessable_entity
    post_agent(channel_id: @channel.id, body: "File", attachments: [ { s3_key: "x" } ], key: "attach-0001")
    assert_response :unprocessable_entity
    assert_equal 0, Message.where(agent_posting_token: @record).count
  end

  test "owner must have accepted the current community terms" do
    @admin.update!(community_terms_version: nil, community_terms_accepted_at: nil)
    post_agent(channel_id: @channel.id, body: "Terms")
    assert_response :forbidden
    assert_equal "community_terms_required", data.fetch("code")
  end

  test "revoked expired malformed home base and Clerk credentials are unauthorized" do
    _hb, home_base = HomeBaseToken.issue!(user: @admin)
    _expiring, expiring = AgentPostingToken.issue!(user: @admin, name: "Short lived", expires_at: 1.hour.from_now)
    with_singleton(ClerkAuth, :verify, ->(*) { flunk "agent endpoint must never consult Clerk" }) do
      [ nil, "Bearer", "Bearer nope", "Basic #{@token}", "Bearer #{@token} extra", "Bearer #{home_base}", "Bearer test_token_#{@admin.id}" ].each do |authorization|
        post ENDPOINT, params: { channel_id: @channel.id, body: "Denied" }, headers: { "Authorization" => authorization, "Idempotency-Key" => "denied-0001" }.compact, as: :json
        assert_response :unauthorized
        assert_equal({ "error" => "Unauthorized" }, data)
      end
    end

    travel 2.hours do
      post ENDPOINT, params: { channel_id: @channel.id, body: "Expired" }, headers: { "Authorization" => "Bearer #{expiring}", "Idempotency-Key" => "expired-0001" }, as: :json
      assert_response :unauthorized
    end

    @record.revoke!
    post_agent(channel_id: @channel.id, body: "Revoked")
    assert_response :unauthorized
    assert_equal 0, Message.where(body: %w[Denied Expired Revoked]).count
  end

  test "posting tokens are rejected by every Clerk-authenticated endpoint" do
    with_singleton(ClerkAuth, :verify, ->(*) { flunk "posting tokens must not reach Clerk" }) do
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Normal path" }, headers: { "Authorization" => "Bearer #{@token}" }, as: :json
      assert_response :unauthorized
      post "/api/v1/direct_conversations/#{@conversation.id}/messages", params: { body: "Normal path" }, headers: { "Authorization" => "Bearer #{@token}" }, as: :json
      assert_response :unauthorized
      get "/api/v1/direct_conversations", headers: { "Authorization" => "Bearer #{@token}" }
      assert_response :unauthorized
      get "/api/v1/agent_posting_tokens", headers: { "Authorization" => "Bearer #{@token}" }
      assert_response :unauthorized
      post "/api/v1/cable_token", headers: { "Authorization" => "Bearer #{@token}" }
      assert_response :unauthorized
    end
    get "/api/v1/home_base/digest", headers: { "Authorization" => "Bearer #{@token}" }
    assert_response :unauthorized
    assert_raises(ActionController::RoutingError, ActionController::UrlGenerationError) do
      Rails.application.routes.recognize_path(ENDPOINT, method: :get)
    end
  end

  test "rate limits each token independently" do
    limit = Api::V1::Agent::MessagesController::RATE_LIMIT
    limit.times { |index| post_agent(body: "No destination", key: "rate-#{index.to_s.rjust(4, '0')}") }
    assert_response :unprocessable_entity
    post_agent(channel_id: @channel.id, body: "Over", key: "rate-over-0001")
    assert_response :too_many_requests
    assert_equal 0, Message.where(body: "Over").count

    _other, other_token = AgentPostingToken.issue!(user: @admin, name: "Other")
    post ENDPOINT, params: { channel_id: @channel.id, body: "Separate bucket" }, headers: { "Authorization" => "Bearer #{other_token}", "Idempotency-Key" => "rate-other-0001" }, as: :json
    assert_response :created
  end

  test "admins manage only their own tokens and the plaintext appears only on create" do
    other_record, = AgentPostingToken.issue!(user: @other_admin, name: "Not yours")

    post "/api/v1/agent_posting_tokens", params: { name: "Laptop assistant", expires_in_days: 30 }, headers: clerk_headers(@admin), as: :json
    assert_response :created
    assert_equal "no-store", response.headers["Cache-Control"]
    plaintext = data.fetch("token")
    assert_match AgentPostingToken::FORMAT, plaintext
    created = AgentPostingToken.find(data.dig("agent_posting_token", "id"))
    assert_equal @admin, created.user
    assert_in_delta 30.days.from_now, created.expires_at, 5.seconds

    get "/api/v1/agent_posting_tokens", headers: clerk_headers(@admin)
    assert_response :success
    assert_not_includes response.body, plaintext
    assert_not_includes response.body, created.token_digest
    ids = data.fetch("agent_posting_tokens").map { |token| token.fetch("id") }
    assert_equal [ created.id, @record.id ], ids
    assert_not_includes ids, other_record.id

    patch "/api/v1/agent_posting_tokens/#{other_record.id}/revoke", headers: clerk_headers(@admin)
    assert_response :not_found
    assert_nil other_record.reload.revoked_at

    patch "/api/v1/agent_posting_tokens/#{created.id}/revoke", headers: clerk_headers(@admin)
    assert_response :success
    assert_equal "revoked", data.dig("agent_posting_token", "status")
    post ENDPOINT, params: { channel_id: @channel.id, body: "After revoke" }, headers: { "Authorization" => "Bearer #{plaintext}", "Idempotency-Key" => "after-revoke-1" }, as: :json
    assert_response :unauthorized

    post "/api/v1/agent_posting_tokens", params: { name: "" }, headers: clerk_headers(@admin), as: :json
    assert_response :unprocessable_entity
    post "/api/v1/agent_posting_tokens", params: { name: "Bad expiry", expires_in_days: 999 }, headers: clerk_headers(@admin), as: :json
    assert_response :unprocessable_entity
  end

  test "non-admins cannot list create or revoke tokens" do
    instructor = user("instructor", :instructor)
    [ @student, instructor ].each do |viewer|
      get "/api/v1/agent_posting_tokens", headers: clerk_headers(viewer)
      assert_response :forbidden
      post "/api/v1/agent_posting_tokens", params: { name: "Sneaky" }, headers: clerk_headers(viewer), as: :json
      assert_response :forbidden
      patch "/api/v1/agent_posting_tokens/#{@record.id}/revoke", headers: clerk_headers(viewer)
      assert_response :forbidden
    end
    assert_equal 1, AgentPostingToken.count
    assert_nil @record.reload.revoked_at
  end

  private

  def user(name, role)
    User.create!(
      clerk_id: "agent_#{name}", email: "agent-#{name}@example.com", first_name: name.capitalize, last_name: "Test", role: role,
      community_terms_version: CommunityPolicy::VERSION, community_terms_accepted_at: Time.current
    )
  end

  def post_agent(key: "retry-key-0001", **params)
    post ENDPOINT, params: params, headers: { "Authorization" => "Bearer #{@token}", "Idempotency-Key" => key }, as: :json
  end

  def clerk_headers(user)
    { "Authorization" => "Bearer test_token_#{user.id}" }
  end

  def data
    JSON.parse(response.body)
  end

  def capture_user_broadcasts
    @broadcasts = []
    original = UserMessagesChannel.method(:broadcast_to)
    sink = @broadcasts
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| sink << [ target, payload ] }
    yield
    @broadcasts
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original) if original
  end

  def broadcasts_so_far
    @broadcasts
  end

  def with_singleton(target, name, replacement)
    original = target.method(name)
    target.define_singleton_method(name, replacement)
    yield
  ensure
    target.define_singleton_method(name, original)
  end
end
