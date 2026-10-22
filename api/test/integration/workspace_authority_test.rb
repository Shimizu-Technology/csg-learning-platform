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
        assert_response :success
        assert_equal false, response.parsed_body.dig("workspace", "can_manage")
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

  test "instructors retain staff-wide visibility and member participation after management removal" do
    @community.workspace_memberships.create!(user: @teacher, role: :member)
    as_user(@teacher) do
      post "/api/v1/channels/#{@channel.id}/messages", params: { body: "Teaching discussion" }, headers: headers, as: :json
      assert_response :created
      assert_equal @teacher.id, Message.last.author_id
    end
    as_user(@admin) do
      delete "/api/v1/workspaces/#{@community.id}/memberships/#{@teacher.id}", headers: headers
      assert_response :success
    end
    as_user(@teacher) do
      get "/api/v1/workspaces", headers: headers
      assert_response :success
      assert_includes response.parsed_body.fetch("workspaces").pluck("id"), @community.id
      get "/api/v1/workspaces/#{@community.id}", headers: headers
      assert_response :success
      refute_includes response.parsed_body.dig("workspace", "members").pluck("id"), @teacher.id
      assert_equal false, response.parsed_body.dig("workspace", "can_manage")
    end
    @community.update!(status: :archived)
    as_user(@teacher) { get "/api/v1/workspaces/#{@community.id}", headers: headers }
    assert_response :forbidden
  end

  private

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
