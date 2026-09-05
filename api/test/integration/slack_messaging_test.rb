require "test_helper"

class SlackMessagingTest < ActionDispatch::IntegrationTest
  include ActiveJob::TestHelper

  def setup
    @curriculum = Curriculum.create!(name: "Bootcamp 2026")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @channel = @cohort.channels.find_by!(name: "Class Chat")

    @student = User.create!(clerk_id: "clerk_student_dm", email: "student-dm@example.com", first_name: "Student", last_name: "One", role: :student)
    @classmate = User.create!(clerk_id: "clerk_classmate_dm", email: "classmate-dm@example.com", first_name: "Class", last_name: "Mate", role: :student)
    @admin = User.create!(clerk_id: "clerk_admin_dm", email: "admin-dm@example.com", first_name: "Admin", last_name: "User", role: :admin)
    @outsider = User.create!(clerk_id: "clerk_outsider_dm", email: "outsider-dm@example.com", first_name: "Out", last_name: "Sider", role: :student)

    [ @student, @classmate, @admin, @outsider ].each do |user|
      user.update!(community_terms_version: CommunityPolicy::VERSION, community_terms_accepted_at: Time.current)
    end

    Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    Enrollment.create!(user: @classmate, cohort: @cohort, status: :active)
  end

  test "student starts a cohort direct conversation and sends a message" do
    as_user(@student) do
      post "/api/v1/direct_conversations",
        params: { cohort_id: @cohort.id, user_ids: [ @admin.id ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    conversation_id = JSON.parse(response.body).dig("direct_conversation", "id")
    conversation = DirectConversation.find(conversation_id)
    assert_equal [ @student.id, @admin.id ].sort, conversation.users.pluck(:id).sort

    assert_enqueued_with(job: PushNotificationJob) do
      as_user(@student) do
        post "/api/v1/direct_conversations/#{conversation.id}/messages",
          params: { body: "Can I ask a quick question?" },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    message = Message.last
    assert_equal conversation, message.direct_conversation
    assert_nil message.channel
    assert_equal 1, @admin.notifications.direct_message.unread.count
    assert_equal 0, @student.notifications.direct_message.count
  end

  test "staff direct messages appear in the recipient conversation list after refresh" do
    instructor = User.create!(
      clerk_id: "clerk_instructor_dm",
      email: "instructor-dm@example.com",
      first_name: "Instructor",
      last_name: "User",
      role: :instructor
    )

    as_user(@admin) do
      post "/api/v1/direct_conversations",
        params: { workspace_id: @cohort.workspace.id, user_ids: [ instructor.id ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    conversation_id = JSON.parse(response.body).dig("direct_conversation", "id")

    as_user(@admin) do
      post "/api/v1/direct_conversations/#{conversation_id}/messages",
        params: { body: "Can you see this direct message?" },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_equal 1, instructor.notifications.direct_message.unread.count

    as_user(instructor) do
      get "/api/v1/direct_conversations", headers: auth_headers
    end

    assert_response :success
    conversations = JSON.parse(response.body).fetch("direct_conversations")
    conversation = conversations.find { |item| item.fetch("id") == conversation_id }

    assert conversation, "expected instructor DM index to include the admin-created conversation"
    assert_equal 1, conversation.fetch("unread_count")
    assert_equal @cohort.workspace.id, conversation.fetch("workspace_id")
    assert_equal "Can you see this direct message?", conversation.dig("latest_message", "body")
    assert conversation.fetch("users").any? { |user| user.fetch("id") == @admin.id }
  end

  test "direct conversation rejects users outside the cohort workspace" do
    as_user(@student) do
      post "/api/v1/direct_conversations",
        params: { cohort_id: @cohort.id, user_ids: [ @outsider.id ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :not_found
  end

  test "direct conversation requires at least one other member" do
    as_user(@student) do
      post "/api/v1/direct_conversations",
        params: { cohort_id: @cohort.id, user_ids: [] },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors"), "Choose at least one other member"
  end

  test "starting an archived direct conversation reopens it" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @admin ])
    conversation.update!(status: :archived)

    as_user(@student) do
      post "/api/v1/direct_conversations",
        params: { cohort_id: @cohort.id, user_ids: [ @admin.id ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_equal conversation.id, JSON.parse(response.body).dig("direct_conversation", "id")
    assert conversation.reload.active?
  end

  test "mute preference suppresses channel message notifications" do
    as_user(@classmate) do
      patch "/api/v1/message_preferences",
        params: { target_type: "Channel", target_id: @channel.id, muted: true },
        headers: auth_headers,
        as: :json
    end

    assert_response :success

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Muted people should not get pushed." },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_equal 0, @classmate.notifications.message.count
    assert_equal 1, @admin.notifications.message.count
  end

  test "message actions update pins and reactions" do
    message = Message.create!(channel: @channel, author: @student, body: "Ship it")

    as_user(@admin) do
      patch "/api/v1/messages/#{message.id}/pin", headers: auth_headers
    end

    assert_response :success
    assert message.reload.pinned?
    assert_equal @admin, message.pinned_by

    as_user(@classmate) do
      post "/api/v1/messages/#{message.id}/reactions",
        params: { emoji: "✅" },
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    assert_equal 1, message.message_reactions.where(emoji: "✅", user: @classmate).count
  end

  test "reaction requires an emoji" do
    message = Message.create!(channel: @channel, author: @student, body: "Ship it")

    as_user(@classmate) do
      post "/api/v1/messages/#{message.id}/reactions",
        params: { emoji: "" },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors"), "Emoji is required"
    assert_equal 0, message.message_reactions.count
  end

  test "reactions are blocked in archived channels" do
    message = Message.create!(channel: @channel, author: @student, body: "Old thread")
    @channel.update!(status: :archived)

    as_user(@classmate) do
      post "/api/v1/messages/#{message.id}/reactions",
        params: { emoji: "👍" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
    assert_equal 0, message.message_reactions.count
  end

  test "reactions are blocked on deleted messages" do
    message = Message.create!(channel: @channel, author: @student, body: "Gone soon", deleted_at: Time.current)

    as_user(@classmate) do
      post "/api/v1/messages/#{message.id}/reactions",
        params: { emoji: "👍" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
    assert_equal 0, message.message_reactions.count
  end

  test "students cannot pin messages" do
    message = Message.create!(channel: @channel, author: @admin, body: "Staff decision")

    as_user(@student) do
      patch "/api/v1/messages/#{message.id}/pin", headers: auth_headers
    end

    assert_response :forbidden
    assert_nil message.reload.pinned_at
  end

  test "staff can create a community workspace with default channel and members" do
    as_user(@admin) do
      post "/api/v1/workspaces",
        params: {
          name: "Alumni",
          description: "Graduates stay connected here",
          user_ids: [ @student.id, @classmate.id ]
        },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    workspace = Workspace.find_by!(name: "Alumni")
    assert workspace.community?
    assert_equal [ @admin.id, @classmate.id, @student.id ].sort, workspace.workspace_memberships.pluck(:user_id).sort
    assert workspace.channels.find_by!(name: "General").present?
  end

  test "student cannot create a community workspace" do
    as_user(@student) do
      post "/api/v1/workspaces",
        params: { name: "Secret Club", description: "Nope" },
        headers: auth_headers,
        as: :json
    end

    assert_response :forbidden
  end

  test "staff can add and remove community workspace members" do
    workspace = Workspace.create!(
      name: "Alumni",
      slug: "alumni",
      workspace_type: :community,
      status: :active,
      description: "Graduates stay connected here"
    )
    workspace.workspace_memberships.create!(user: @admin, role: :manager)
    workspace.ensure_default_channels!

    as_user(@admin) do
      post "/api/v1/workspaces/#{workspace.id}/memberships",
        params: { user_ids: [ @student.id, @classmate.id ] },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_equal [ @admin.id, @classmate.id, @student.id ].sort, workspace.reload.workspace_memberships.pluck(:user_id).sort

    as_user(@admin) do
      delete "/api/v1/workspaces/#{workspace.id}/memberships/#{@classmate.id}",
        headers: auth_headers,
        as: :json
    end

    assert_response :success
    assert_equal [ @admin.id, @student.id ].sort, workspace.reload.workspace_memberships.pluck(:user_id).sort
  end

  test "workspace index includes community workspace memberships for members" do
    workspace = Workspace.create!(
      name: "Alumni",
      slug: "alumni",
      workspace_type: :community,
      status: :active,
      description: "Graduates stay connected here"
    )
    workspace.workspace_memberships.create!(user: @student, role: :member)

    as_user(@student) do
      get "/api/v1/workspaces", headers: auth_headers
    end

    assert_response :success
    names = JSON.parse(response.body).fetch("workspaces").map { |item| item.fetch("name") }
    assert_includes names, "Cohort 3"
    assert_includes names, "Alumni"
  end

  test "workspace index limits students to memberships while staff see every active workspace" do
    other_cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 4", start_date: Date.current, status: :active)

    as_user(@student) do
      get "/api/v1/workspaces", headers: auth_headers
    end

    assert_response :success
    student_names = JSON.parse(response.body).fetch("workspaces").map { |item| item.fetch("name") }
    assert_equal [ "Cohort 3" ], student_names

    as_user(@admin) do
      get "/api/v1/workspaces", headers: auth_headers
    end

    assert_response :success
    staff_names = JSON.parse(response.body).fetch("workspaces").map { |item| item.fetch("name") }
    assert_includes staff_names, "Cohort 3"
    assert_includes staff_names, other_cohort.name
  end

  test "channel index includes attachment-only latest message previews without extra fetches" do
    message = Message.create!(channel: @channel, author: @admin, body: nil)
    message.message_attachments.create!(
      s3_key: "messages/workspaces/#{@cohort.workspace.id}/channels/#{@channel.id}/example.png",
      filename: "example.png",
      content_type: "image/png",
      byte_size: 1024,
      uploaded_by: @admin
    )

    as_user(@student) do
      get "/api/v1/channels", headers: auth_headers
    end

    assert_response :success
    preview = JSON.parse(response.body).fetch("channels").first.fetch("latest_message").fetch("body")
    assert_equal "Attachment", preview
  end

  test "channel show returns the latest message window in chronological order" do
    5.times do |index|
      Message.create!(channel: @channel, author: @admin, body: "Channel message #{index}", created_at: index.minutes.ago)
    end

    as_user(@student) do
      get "/api/v1/channels/#{@channel.id}",
        params: { message_limit: 2 },
        headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    bodies = body.fetch("messages").map { |message| message.fetch("body") }
    assert_equal [ "Channel message 1", "Channel message 0" ], bodies
    assert body.fetch("meta").fetch("has_older")
    assert_not body.fetch("meta").fetch("has_newer")
  end

  test "channel show pages older messages before an anchor without overlap" do
    messages = 5.times.map do |index|
      Message.create!(channel: @channel, author: @admin, body: "Paged channel message #{index}", created_at: (5 - index).minutes.ago)
    end

    as_user(@student) do
      get "/api/v1/channels/#{@channel.id}",
        params: { message_limit: 2, before_message_id: messages[3].id },
        headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal [ messages[1].id, messages[2].id ], body.fetch("messages").map { |message| message.fetch("id") }
    assert body.fetch("meta").fetch("has_older")
    assert body.fetch("meta").fetch("has_newer")
  end

  test "direct conversation show returns a window around a searched message" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @admin ])
    messages = 5.times.map do |index|
      Message.create!(direct_conversation: conversation, author: @admin, body: "Direct message #{index}", created_at: index.minutes.ago)
    end

    as_user(@student) do
      get "/api/v1/direct_conversations/#{conversation.id}",
        params: { message_limit: 3, around_message_id: messages[3].id },
        headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    bodies = body.fetch("messages").map { |message| message.fetch("body") }
    assert_equal [ "Direct message 4", "Direct message 3", "Direct message 2" ], bodies
    assert_not body.fetch("meta").fetch("has_older")
    assert body.fetch("meta").fetch("has_newer")
  end

  test "message create requires text or attachment" do
    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "" },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors"), "Message must include text or an attachment"
  end

  test "message create replays the original result for the same client message id" do
    params = {
      body: "Send this once",
      client_message_id: "message-retry-1",
      mention_user_ids: [ @classmate.id ]
    }

    broadcasts = []
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| broadcasts << [ target, payload ] }
    assert_difference("Message.count", 1) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: params,
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :created
    message_id = JSON.parse(response.body).dig("message", "id")
    assert Message.find(message_id).delivery_tracking_requested?, "new API messages must opt into recovery tracking"
    notification_count = Notification.where(notifiable_type: "Message", notifiable_id: message_id).count
    assert_operator notification_count, :>, 0
    assert_operator broadcasts.length, :>, 0
    broadcast_count = broadcasts.length

    assert_no_difference([ "Message.count", "Notification.count" ]) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: params,
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :ok
    assert_equal message_id, JSON.parse(response.body).dig("message", "id")
    assert_equal "message-retry-1", JSON.parse(response.body).dig("message", "client_message_id")
    assert_equal notification_count, Notification.where(notifiable_type: "Message", notifiable_id: message_id).count
    assert_equal broadcast_count, broadcasts.length, "replayed sends must not emit another realtime event"

    as_user(@classmate) do
      get "/api/v1/channels/#{@channel.id}", headers: auth_headers
    end
    delivered = JSON.parse(response.body).fetch("messages").find { |message| message.fetch("id") == message_id }
    assert_not delivered.key?("client_message_id"), "client message IDs must remain private to their author"
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
  end

  test "message create rejects a client message id reused for different content" do
    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Original intent", client_message_id: "message-retry-conflict" },
        headers: auth_headers,
        as: :json
    end
    assert_response :created

    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Different intent", client_message_id: "message-retry-conflict" },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :conflict
    assert_includes JSON.parse(response.body).fetch("errors"), "Client message ID has already been used for a different message"

    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Original intent", client_message_id: "message-retry-conflict", mention_user_ids: [ @classmate.id ] },
          headers: auth_headers,
          as: :json
      end
    end
    assert_response :conflict

    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @admin ])
    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/direct_conversations/#{conversation.id}/messages",
          params: { body: "Original intent", client_message_id: "message-retry-conflict" },
          headers: auth_headers,
          as: :json
      end
    end
    assert_response :conflict

    student_message_id = Message.find_by!(author: @student, client_message_id: "message-retry-conflict").id
    as_user(@classmate) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Classmate intent", client_message_id: "message-retry-conflict" },
        headers: auth_headers,
        as: :json
    end

    assert_response :created
    assert_not_equal student_message_id, JSON.parse(response.body).dig("message", "id")
  end

  test "message replay preserves the original push preference without duplicate fanout" do
    params = {
      body: "Push this once",
      client_message_id: "message-push-precedence",
      send_push: true
    }

    assert_enqueued_jobs 1, only: PushNotificationJob do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
      end
      assert_response :created

      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: params.merge(send_push: false),
          headers: auth_headers,
          as: :json
      end
      assert_response :ok
    end

    message = Message.find_by!(author: @student, client_message_id: "message-push-precedence")
    assert message.delivery_push_requested?
  end

  test "message retries accept the same attachments in a different request order" do
    original_configured = S3Service.method(:configured?)
    S3Service.define_singleton_method(:configured?) { false }
    attachments = [
      { s3_key: "message_attachments/channel_#{@channel.id}/first.txt", filename: "first.txt", content_type: "text/plain", byte_size: 11 },
      { s3_key: "message_attachments/channel_#{@channel.id}/second.txt", filename: "second.txt", content_type: "text/plain", byte_size: 12 }
    ]
    params = { body: "Same files", client_message_id: "message-attachment-order", attachments: attachments }

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
    end
    assert_response :created
    message_id = JSON.parse(response.body).dig("message", "id")

    assert_no_difference([ "Message.count", "MessageAttachment.count" ]) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: params.merge(attachments: attachments.reverse),
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :ok
    assert_equal message_id, JSON.parse(response.body).dig("message", "id")
  ensure
    S3Service.define_singleton_method(:configured?, original_configured) if defined?(original_configured) && original_configured
  end

  test "message retries preserve the original mention intent after membership changes" do
    params = { body: "Before you go", client_message_id: "message-membership-change", mention_user_ids: [ @classmate.id ] }
    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
    end
    assert_response :created
    message_id = JSON.parse(response.body).dig("message", "id")
    @classmate.update!(archived_at: Time.current)

    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
      end
    end

    assert_response :ok
    assert_equal message_id, JSON.parse(response.body).dig("message", "id")
  end

  test "message retries reject a changed attachment set" do
    original_configured = S3Service.method(:configured?)
    S3Service.define_singleton_method(:configured?) { false }
    first = { s3_key: "message_attachments/channel_#{@channel.id}/first.txt", filename: "first.txt", content_type: "text/plain", byte_size: 11 }
    additional = { s3_key: "message_attachments/channel_#{@channel.id}/additional.txt", filename: "additional.txt", content_type: "text/plain", byte_size: 15 }
    params = { body: "Exact files only", client_message_id: "message-attachment-conflict", attachments: [ first ] }

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
    end
    assert_response :created

    assert_no_difference([ "Message.count", "MessageAttachment.count" ]) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: params.merge(attachments: [ first, additional ]),
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :conflict
  ensure
    S3Service.define_singleton_method(:configured?, original_configured) if defined?(original_configured) && original_configured
  end

  test "validation-time duplicate races replay the committed message" do
    client_message_id = "message-validation-race"
    winner = Message.create!(channel: @channel, author: @student, body: "Race-safe send", client_message_id: client_message_id)
    original_lookup = Api::V1::MessagesController.instance_method(:existing_message_for_client_id)
    lookup_count = 0
    Api::V1::MessagesController.define_method(:existing_message_for_client_id) do
      lookup_count += 1
      lookup_count == 1 ? nil : original_lookup.bind_call(self)
    end
    Api::V1::MessagesController.send(:private, :existing_message_for_client_id)

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Race-safe send", client_message_id: client_message_id },
        headers: auth_headers,
        as: :json
    end

    assert_response :ok
    assert_equal winner.id, JSON.parse(response.body).dig("message", "id")
    assert_equal 1, Message.where(author: @student, client_message_id: client_message_id).count
  ensure
    if defined?(original_lookup) && original_lookup
      Api::V1::MessagesController.define_method(:existing_message_for_client_id, original_lookup)
      Api::V1::MessagesController.send(:private, :existing_message_for_client_id)
    end
  end

  test "database uniqueness races replay the committed message inside an outer transaction" do
    client_message_id = "message-index-race"
    winner = Message.create!(channel: @channel, author: @student, body: "Index-safe send", client_message_id: client_message_id)
    original_lookup = Api::V1::MessagesController.instance_method(:existing_message_for_client_id)
    lookup_count = 0
    Api::V1::MessagesController.define_method(:existing_message_for_client_id) do
      lookup_count += 1
      lookup_count == 1 ? nil : original_lookup.bind_call(self)
    end
    Api::V1::MessagesController.send(:private, :existing_message_for_client_id)
    save_was_owned = Message.instance_methods(false).include?(:save!)
    original_save = Message.instance_method(:save!)
    target_client_message_id = client_message_id
    Message.define_method(:save!) do |*args, **kwargs|
      if self[:client_message_id] == target_client_message_id
        self.class.insert!({
          author_id: author_id,
          body: body,
          channel_id: channel_id,
          client_message_id: client_message_id,
          direct_conversation_id: direct_conversation_id,
          mention_user_ids: mention_user_ids,
          parent_message_id: parent_message_id,
          created_at: Time.current,
          updated_at: Time.current
        })
      else
        original_save.bind_call(self, *args, **kwargs)
      end
    end

    Message.transaction(requires_new: true) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Index-safe send", client_message_id: client_message_id },
          headers: auth_headers,
          as: :json
      end

      assert_response :ok
      assert_equal winner.id, JSON.parse(response.body).dig("message", "id")
      assert_equal winner.id, Message.find_by!(author: @student, client_message_id: client_message_id).id
    end
  ensure
    if defined?(original_save) && original_save
      if defined?(save_was_owned) && save_was_owned
        Message.define_method(:save!, original_save)
      elsif Message.instance_methods(false).include?(:save!)
        Message.send(:remove_method, :save!)
      end
    end
    if defined?(original_lookup) && original_lookup
      Api::V1::MessagesController.define_method(:existing_message_for_client_id, original_lookup)
      Api::V1::MessagesController.send(:private, :existing_message_for_client_id)
    end
  end

  test "unrelated record-not-unique errors are not treated as message replays" do
    original_persist = Api::V1::MessagesController.instance_method(:persist_files!)
    Api::V1::MessagesController.define_method(:persist_files!) do |message, attachments|
      raise ActiveRecord::RecordNotUnique, "different unique index" if message.client_message_id == "unrelated-constraint"

      original_persist.bind_call(self, message, attachments)
    end
    Api::V1::MessagesController.send(:private, :persist_files!)

    assert_raises(ActiveRecord::RecordNotUnique) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Must not replay", client_message_id: "unrelated-constraint" },
          headers: auth_headers,
          as: :json
      end
    end
    assert_not Message.exists?(author: @student, client_message_id: "unrelated-constraint")
  ensure
    if defined?(original_persist) && original_persist
      Api::V1::MessagesController.define_method(:persist_files!, original_persist)
      Api::V1::MessagesController.send(:private, :persist_files!)
    end
  end

  test "inline delivery failure asks the client to retry the committed message" do
    original_delivery = NotificationDeliveryService.method(:message_created)
    original_user_broadcast = UserMessagesChannel.method(:broadcast_to)
    broadcasts = []
    UserMessagesChannel.define_singleton_method(:broadcast_to) { |target, payload| broadcasts << [ target, payload ] }
    fail_delivery = true
    NotificationDeliveryService.define_singleton_method(:message_created) do |message, push: false|
      raise "delivery interrupted" if fail_delivery

      original_delivery.call(message, push: push)
    end
    params = { body: "Recover delivery", client_message_id: "message-delivery-recovery" }

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
    end
    assert_response :service_unavailable
    committed = Message.find_by!(author: @student, client_message_id: "message-delivery-recovery")
    assert_nil committed.notifications_delivered_at

    fail_delivery = false
    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
      end
    end

    assert_response :ok
    committed.reload
    assert committed.notifications_delivered_at?
    assert committed.broadcasts_delivered_at?
    assert_empty committed.delivered_recipient_ids(:broadcast_recipient_ids)
    notification_count = Notification.where(notifiable_type: "Message", notifiable_id: committed.id).count
    broadcast_count = broadcasts.length
    assert_operator notification_count, :>, 0
    assert_operator broadcast_count, :>, 0

    assert_no_difference([ "Message.count", "Notification.count" ]) do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
      end
    end
    assert_response :ok
    assert_equal notification_count, Notification.where(notifiable_type: "Message", notifiable_id: committed.id).count
    assert_equal broadcast_count, broadcasts.length
  ensure
    UserMessagesChannel.define_singleton_method(:broadcast_to, original_user_broadcast) if defined?(original_user_broadcast) && original_user_broadcast
    NotificationDeliveryService.define_singleton_method(:message_created, original_delivery) if defined?(original_delivery) && original_delivery
  end

  test "deleted messages cannot be replayed" do
    params = { body: "Delete this", client_message_id: "message-deleted-retry" }
    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
    end
    assert_response :created
    Message.find_by!(author: @student, client_message_id: "message-deleted-retry").update!(deleted_at: Time.current)

    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages", params: params, headers: auth_headers, as: :json
      end
    end

    assert_response :conflict
  end

  test "message create rejects client message ids outside the contract" do
    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Too long an id", client_message_id: "m" * 101 },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors"), "Client message ID is too long (maximum is 100 characters)"
  end

  test "message create rejects malformed mention user ids" do
    assert_no_difference("Message.count") do
      as_user(@student) do
        post "/api/v1/channels/#{@channel.id}/messages",
          params: { body: "Malformed mention", mention_user_ids: [ "#{@classmate.id}invalid" ] },
          headers: auth_headers,
          as: :json
      end
    end

    assert_response :unprocessable_entity
    assert_equal [ "Mention user IDs must be numeric" ], JSON.parse(response.body).fetch("errors")
  end

  test "thread endpoint returns the root and chronological replies with a reply count" do
    root = Message.create!(channel: @channel, author: @admin, body: "Thread root", created_at: 10.minutes.ago)
    later = Message.create!(channel: @channel, author: @student, body: "Second reply", parent_message: root, created_at: 2.minutes.ago)
    earlier = Message.create!(channel: @channel, author: @admin, body: "First reply", parent_message: root, created_at: 5.minutes.ago)

    as_user(@student) do
      get "/api/v1/messages/#{later.id}/thread", headers: auth_headers
    end

    assert_response :success
    body = JSON.parse(response.body)
    assert_equal root.id, body.fetch("root_message").fetch("id")
    assert_equal 2, body.fetch("root_message").fetch("reply_count")
    assert_equal [ earlier.id, later.id ], body.fetch("replies").map { |reply| reply.fetch("id") }
  end

  test "message replies cannot create nested thread chains" do
    root = Message.create!(channel: @channel, author: @admin, body: "Thread root")
    reply = Message.create!(channel: @channel, author: @student, body: "First-level reply", parent_message: root)

    as_user(@student) do
      post "/api/v1/channels/#{@channel.id}/messages",
        params: { body: "Nested reply", parent_message_id: reply.id },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
    assert_includes JSON.parse(response.body).fetch("errors"), "Parent message must be a thread root"
  end

  test "deleting a pinned message clears its pin state" do
    message = Message.create!(channel: @channel, author: @student, body: "Pinned then removed", pinned_at: Time.current, pinned_by: @admin)

    as_user(@student) do
      delete "/api/v1/messages/#{message.id}", headers: auth_headers
    end

    assert_response :success
    message.reload
    assert message.deleted?
    assert_nil message.pinned_at
    assert_nil message.pinned_by
  end

  test "a committed deletion returns success and remains recoverable when broadcast fails" do
    message = Message.create!(
      channel: @channel,
      author: @student,
      body: "Remove reliably",
      delivery_tracking_requested: true,
      notifications_delivery_claim: SecureRandom.uuid,
      notifications_delivery_started_at: Time.current,
      broadcasts_delivered_at: Time.current
    )
    original_delete_broadcast = MessageBroadcastService.method(:deleted)
    original_queue_adapter_name = ActiveJob::Base.method(:queue_adapter_name)
    ActiveJob::Base.define_singleton_method(:queue_adapter_name) { "solid_queue" }
    fail_delete_broadcast = true
    MessageBroadcastService.define_singleton_method(:deleted) do |target, **options, &block|
      raise "delete broadcast unavailable" if fail_delete_broadcast

      original_delete_broadcast.call(target, **options, &block)
    end

    as_user(@student) do
      delete "/api/v1/messages/#{message.id}", headers: auth_headers
    end

    assert_response :success
    assert message.reload.deleted?
    assert message.notifications_delivered_at?
    assert_nil message.notifications_delivery_claim
    assert_nil message.broadcasts_delivered_at
    assert_nil message.broadcast_delivery_claim

    fail_delete_broadcast = false
    MessageDeliveryService.created(message)
    assert message.reload.broadcasts_delivered_at?
  ensure
    ActiveJob::Base.define_singleton_method(:queue_adapter_name, original_queue_adapter_name) if defined?(original_queue_adapter_name) && original_queue_adapter_name
    MessageBroadcastService.define_singleton_method(:deleted, original_delete_broadcast) if defined?(original_delete_broadcast) && original_delete_broadcast
  end

  test "thread endpoint does not expose a conversation after access is lost" do
    root = Message.create!(channel: @channel, author: @admin, body: "Private after dropout")
    @student.enrollments.find_by!(cohort: @cohort).update!(status: :dropped)

    as_user(@student) do
      get "/api/v1/messages/#{root.id}/thread", headers: auth_headers
    end

    assert_response :forbidden
  end

  test "mark read reuses existing read state without validation failure" do
    message = Message.create!(channel: @channel, author: @admin, body: "Read me")
    ChannelReadState.create!(user: @student, channel: @channel, last_read_at: 1.hour.ago)

    as_user(@student) do
      patch "/api/v1/channels/#{@channel.id}/read", headers: auth_headers
    end

    assert_response :success
    assert_equal message, @student.channel_read_states.find_by!(channel: @channel).last_read_message
  end

  test "channel show includes read receipts keyed by message id" do
    message = Message.create!(channel: @channel, author: @student, body: "Seen in channel", created_at: 5.minutes.ago)
    ChannelReadState.create!(user: @classmate, channel: @channel, last_read_at: 1.minute.ago)

    as_user(@student) do
      get "/api/v1/channels/#{@channel.id}", headers: auth_headers
    end

    assert_response :success
    message_json = JSON.parse(response.body).fetch("messages").find { |item| item.fetch("id") == message.id }
    receipts = message_json.fetch("read_receipts")
    assert_equal 1, receipts.fetch("count")
    assert_equal [ @classmate.id ], receipts.fetch("users").map { |user| user.fetch("id") }
  end

  test "direct conversation show includes read receipts keyed by message id" do
    conversation = DirectConversation.find_or_create_for!(workspace: @cohort.workspace, users: [ @student, @admin ])
    message = Message.create!(direct_conversation: conversation, author: @student, body: "Seen in DM", created_at: 5.minutes.ago)
    conversation.direct_conversation_members.find_by!(user: @admin).update!(last_read_at: 1.minute.ago)

    as_user(@student) do
      get "/api/v1/direct_conversations/#{conversation.id}", headers: auth_headers
    end

    assert_response :success
    message_json = JSON.parse(response.body).fetch("messages").find { |item| item.fetch("id") == message.id }
    receipts = message_json.fetch("read_receipts")
    assert_equal 1, receipts.fetch("count")
    assert_equal [ @admin.id ], receipts.fetch("users").map { |user| user.fetch("id") }
  end

  test "attachment presign rejects svg content types" do
    original_configured = S3Service.method(:configured?)
    S3Service.define_singleton_method(:configured?) { true }

    as_user(@student) do
      post "/api/v1/message_attachments/presign",
        params: { channel_id: @channel.id, filename: "logo.svg", content_type: "image/svg+xml" },
        headers: auth_headers,
        as: :json
    end

    assert_response :unprocessable_entity
  ensure
    S3Service.define_singleton_method(:configured?, original_configured)
  end

  test "search only returns messages visible to the current user" do
    visible_message = Message.create!(channel: @channel, author: @admin, body: "Searchable cohort note")
    staff_channel = @cohort.channels.create!(name: "Staff Room", visibility: :staff_only)
    Message.create!(channel: staff_channel, author: @admin, body: "Searchable staff note")

    as_user(@student) do
      get "/api/v1/messages/search",
        params: { q: "Searchable" },
        headers: auth_headers
    end

    assert_response :success
    results = JSON.parse(response.body).fetch("results")
    ids = results.map { |result| result.fetch("id") }
    assert_equal [ visible_message.id ], ids
    assert_equal @channel.workspace_id, results.first.fetch("context").fetch("workspace_id")
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
