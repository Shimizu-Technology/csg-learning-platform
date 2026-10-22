require "test_helper"

class WorkspaceAuthorityTest < ActionDispatch::IntegrationTest
  setup do
    @curriculum = Curriculum.create!(name: "Workspace authority")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Assigned cohort", start_date: Date.current, status: :active)
    @other_cohort = Cohort.create!(curriculum: @curriculum, name: "Other cohort", start_date: Date.current, status: :active)
    @admin = user("admin", :admin)
    @teacher = user("teacher", :instructor)
    @outsider = user("outsider", :instructor)
    @student = user("student", :student)
    @cohort.cohort_instructor_assignments.create!(user: @teacher)
    @community = Workspace.create!(name: "Staff-wide community", slug: "authority-community", workspace_type: :community)
    @community.ensure_default_channels!
    @channel = @community.channels.first
  end

  test "community writes are denied for unrelated member and manager instructors" do
    [ nil, :member, :manager ].each do |membership_role|
      @community.workspace_memberships.where(user: @teacher).delete_all
      @community.workspace_memberships.create!(user: @teacher, role: membership_role) if membership_role
      as_user(@teacher) do
        post "/api/v1/workspaces", params: { name: "Unauthorized community" }, headers: headers, as: :json
        assert_response :forbidden
        patch "/api/v1/workspaces/#{@community.id}", params: { name: "Changed", status: "archived" }, headers: headers, as: :json
        assert_response :forbidden
        post "/api/v1/workspaces/#{@community.id}/memberships", params: { user_ids: [ @student.id ], role: "manager" }, headers: headers, as: :json
        assert_response :forbidden
        delete "/api/v1/workspaces/#{@community.id}/memberships/#{@teacher.id}", headers: headers
        assert_response :forbidden
        post "/api/v1/channels", params: { workspace_id: @community.id, name: "Unauthorized channel" }, headers: headers, as: :json
        assert_response :forbidden
        patch "/api/v1/channels/#{@channel.id}", params: { name: "Changed" }, headers: headers, as: :json
        assert_response :forbidden
        delete "/api/v1/channels/#{@channel.id}", headers: headers
        assert_response :forbidden
        get "/api/v1/workspaces/#{@community.id}", headers: headers
        assert_response(membership_role ? :success : :forbidden)
        assert_equal false, response.parsed_body.dig("workspace", "can_manage") if membership_role
      end
      assert_equal "Staff-wide community", @community.reload.name
      assert @community.active?
      assert @channel.reload.active?
      refute @community.workspace_memberships.exists?(user: @student)
    end
  end

  test "admin can manage community lifecycle memberships and channels" do
    as_user(@admin) do
      post "/api/v1/workspaces", params: { name: "New community", user_ids: [ @teacher.id ] }, headers: headers, as: :json
      assert_response :created
      workspace_id = response.parsed_body.dig("workspace", "id")
      assert_equal true, response.parsed_body.dig("workspace", "can_manage")
      patch "/api/v1/workspaces/#{workspace_id}", params: { name: "Renamed community" }, headers: headers, as: :json
      assert_response :success
      assert_equal "Renamed community", Workspace.find(workspace_id).name
      post "/api/v1/workspaces/#{workspace_id}/memberships", params: { user_ids: [ @student.id ] }, headers: headers, as: :json
      assert_response :created
      assert WorkspaceMembership.exists?(workspace_id: workspace_id, user: @student)
      delete "/api/v1/workspaces/#{workspace_id}/memberships/#{@student.id}", headers: headers
      assert_response :success
      refute WorkspaceMembership.exists?(workspace_id: workspace_id, user: @student)
      post "/api/v1/channels", params: { workspace_id: workspace_id, name: "Community channel" }, headers: headers, as: :json
      assert_response :created
      channel_id = response.parsed_body.dig("channel", "id")
      patch "/api/v1/channels/#{channel_id}", params: { name: "Renamed channel" }, headers: headers, as: :json
      assert_response :success
      assert_equal "Renamed channel", Channel.find(channel_id).name
      delete "/api/v1/channels/#{channel_id}", headers: headers
      assert_response :success
      assert Channel.find(channel_id).archived?
      patch "/api/v1/workspaces/#{workspace_id}", params: { status: "archived" }, headers: headers, as: :json
      assert_response :success
      assert Workspace.find(workspace_id).archived?
      get "/api/v1/workspaces", headers: headers
      refute_includes response.parsed_body.fetch("workspaces").pluck("id"), workspace_id
    end
  end

  test "assigned instructor retains cohort channel management by workspace and cohort id" do
    as_user(@teacher) do
      [ { workspace_id: @cohort.workspace.id }, { cohort_id: @cohort.id } ].each do |target|
        post "/api/v1/channels", params: target.merge(name: "Teaching channel #{target.keys.first}"), headers: headers, as: :json
        assert_response :created
        channel_id = response.parsed_body.dig("channel", "id")
        patch "/api/v1/channels/#{channel_id}", params: { name: "Teaching updates #{target.keys.first}" }, headers: headers, as: :json
        assert_response :success
        assert_equal "Teaching updates #{target.keys.first}", Channel.find(channel_id).name
        delete "/api/v1/channels/#{channel_id}", headers: headers
        assert_response :success
        assert Channel.find(channel_id).archived?
      end
      [ { workspace_id: @other_cohort.workspace.id }, { cohort_id: @other_cohort.id } ].each do |target|
        post "/api/v1/channels", params: target.merge(name: "Unauthorized"), headers: headers, as: :json
        assert_response :forbidden
      end
      other_channel = @other_cohort.channels.first
      patch "/api/v1/channels/#{other_channel.id}", params: { name: "Unauthorized" }, headers: headers, as: :json
      assert_response :forbidden
      delete "/api/v1/channels/#{other_channel.id}", headers: headers
      assert_response :forbidden
      post "/api/v1/workspaces/#{@cohort.workspace.id}/memberships", params: { user_ids: [ @student.id ] }, headers: headers, as: :json
      assert_response :forbidden
    end
  end

  test "nonmember and removed instructors cannot discover read post or search community messages" do
    Message.create!(channel: @channel, author: @admin, body: "Membership secret")
    assert_community_denied(@outsider)
    @community.workspace_memberships.create!(user: @teacher)
    as_user(@teacher) do
      get "/api/v1/channels/#{@channel.id}", headers: headers
      assert_response :success
    end
    as_user(@admin) do
      delete "/api/v1/workspaces/#{@community.id}/memberships/#{@teacher.id}", headers: headers
      assert_response :success
    end
    assert_community_denied(@teacher)
  end

  test "member instructors and nonmember admins can list read post and search communities" do
    @community.workspace_memberships.create!(user: @teacher)
    [ @teacher, @admin ].each do |viewer|
      as_user(viewer) do
        get "/api/v1/workspaces", headers: headers
        assert_response :success
        assert_includes response.parsed_body.fetch("workspaces").pluck("id"), @community.id
        get "/api/v1/workspaces/#{@community.id}", headers: headers
        assert_response :success
        post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Membership secret" }, headers: headers, as: :json
        assert_response :created
        message_id = response.parsed_body.dig("message", "id")
        get "/api/v1/channels/#{@channel.id}", headers: headers
        assert_response :success
        assert_includes response.parsed_body.fetch("messages").pluck("id"), message_id
        get "/api/v1/messages/search", params: { q: "Membership secret" }, headers: headers
        assert_response :success
        assert_includes response.parsed_body.fetch("results").pluck("id"), message_id
      end
    end
  end

  test "community recipients mentions and pickers exclude nonmembers including staff-only channels" do
    @community.workspace_memberships.create!(user: @teacher)
    @community.workspace_memberships.create!(user: @student)
    staff_channel = @community.channels.create!(name: "Staff members", visibility: :staff_only)
    assert_equal [ @admin.id, @teacher.id, @student.id ].sort, @channel.recipients.reorder(nil).pluck(:id).sort
    assert_equal [ @admin.id, @teacher.id ].sort, staff_channel.recipients.reorder(nil).pluck(:id).sort
    as_user(@teacher) do
      get "/api/v1/direct_conversations/available_users", params: { workspace_id: @community.id }, headers: headers
      assert_response :success
      ids = response.parsed_body.fetch("users").pluck("id")
      assert_includes ids, @admin.id
      assert_includes ids, @student.id
      refute_includes ids, @outsider.id
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Hello", mention_user_ids: [ @student.id, @outsider.id ] }, headers: headers, as: :json
      assert_response :created
      assert_equal [ @student.id ], Message.last.mention_user_ids
    end
    @community.workspace_memberships.find_by!(user: @teacher).destroy!
    [ @channel, staff_channel ].each do |channel|
      refute_includes channel.recipients.reorder(nil).pluck(:id), @teacher.id
      message = Message.create!(channel: channel, author: @admin, body: "@everyone secret", mention_user_ids: [ @teacher.id, @outsider.id ])
      notifications = NotificationDeliveryService.message_created(message)
      refute_includes notifications.map(&:user_id), @teacher.id
      refute_includes notifications.map(&:user_id), @outsider.id
    end
  end

  test "removal hides saved notifications and cancels queued message and mention delivery" do
    @community.workspace_memberships.create!(user: @teacher)
    conversation = DirectConversation.find_or_create_for!(workspace: @community, users: [ @teacher, @admin ])
    messages = [
      Message.create!(channel: @channel, author: @admin, body: "Channel secret"),
      Message.create!(direct_conversation: conversation, author: @admin, body: "Direct secret")
    ]
    notifications = messages.map { |message| NotificationDeliveryService.message_created(message).find { |notification| notification.user_id == @teacher.id } }
    assert notifications.all?
    assert_equal notifications.map(&:id).sort, @teacher.notifications.visible_to(@teacher).pluck(:id).sort
    @community.workspace_memberships.find_by!(user: @teacher).destroy!
    as_user(@teacher) do
      get "/api/v1/notifications", headers: headers
      assert_response :success
      assert_empty response.parsed_body.fetch("notifications")
      assert_equal 0, response.parsed_body.fetch("unread_count")
      get "/api/v1/direct_conversations/#{conversation.id}", headers: headers
      assert_response :forbidden
    end
    messages.zip(notifications).each do |message, notification|
      with_method(WebPushNotificationService, :message_created, ->(_message, recipients) { assert_empty recipients }) do
        with_method(ExpoPushNotificationService, :message_created, ->(_message, recipients) { assert_empty recipients }) do
          PushNotificationJob.perform_now("Message", message.id, [ notification.id ])
        end
      end
      with_method(NotificationEmailService, :send_message_notification, ->(**) { flunk "Removed member received message email" }) do
        MessageNotificationEmailJob.perform_now(message.id, [ notification.id ])
      end
      with_method(NotificationEmailService, :send_message_mention, ->(**) { flunk "Removed member received mention email" }) do
        MessageMentionEmailJob.perform_now(message.id, [ @teacher.id ])
      end
    end
  end

  private

  def assert_community_denied(viewer)
    as_user(viewer) do
      get "/api/v1/workspaces", headers: headers
      assert_response :success
      refute_includes response.parsed_body.fetch("workspaces").pluck("id"), @community.id
      get "/api/v1/channels", headers: headers
      assert_response :success
      refute_includes response.parsed_body.fetch("channels").pluck("id"), @channel.id
      get "/api/v1/workspaces/#{@community.id}", headers: headers
      assert_response :forbidden
      get "/api/v1/channels/#{@channel.id}", headers: headers
      assert_response :forbidden
      assert_no_difference("Message.count") do
        post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Unauthorized" }, headers: headers, as: :json
        assert_response :forbidden
      end
      get "/api/v1/messages/search", params: { q: "Membership secret" }, headers: headers
      assert_response :success
      assert_empty response.parsed_body.fetch("results")
      get "/api/v1/direct_conversations/available_users", params: { workspace_id: @community.id }, headers: headers
      assert_response :forbidden
    end
  end

  def with_method(target, name, replacement)
    original = target.method(name)
    target.define_singleton_method(name, replacement)
    yield
  ensure
    target.define_singleton_method(name, original)
  end

  def headers = { "Authorization" => "Bearer test_token" }

  def user(name, role)
    User.create!(clerk_id: "authority_#{name}", email: "authority-#{name}@example.com", role: role,
      community_terms_version: CommunityPolicy::VERSION, community_terms_accepted_at: Time.current)
  end

  def as_user(user)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name } }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
