require "test_helper"

# M-13: an optional @handle people set in Profile, so two people with the same
# name in one workspace can be told apart without showing anyone's email.
class UserHandlesTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Handles curriculum")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    @instructor = person("instructor", :instructor, first: "Taylor", last: "Staff")
    @cohort.cohort_instructor_assignments.create!(user: @instructor)
    @student = person("student", :student, first: "Alex", last: "Rivera")
    @twin = person("twin", :student, first: "Alex", last: "Rivera")
    [ @student, @twin ].each { |user| Enrollment.create!(user: user, cohort: @cohort, status: :active) }
  end

  test "handles are normalized to lowercase and validated" do
    @student.update!(handle: "  @Alex_R ")
    assert_equal "alex_r", @student.reload.handle

    @student.update!(handle: "")
    assert_nil @student.reload.handle, "Blank clears the handle"

    { "ab" => "must be 3-30", "a" * 31 => "must be 3-30", "_alex" => "must be 3-30", "alex r" => "must be 3-30",
      "alex.r" => "must be 3-30", "álex" => "must be 3-30", "everyone" => "is reserved", "here" => "is reserved" }.each do |value, message|
      @student.handle = value
      refute @student.valid?, value
      assert @student.errors[:handle].any? { |error| error.include?(message) }, "#{value}: #{@student.errors[:handle].inspect}"
    end
    @student.handle = "a" * 30
    assert @student.valid?
  end

  test "handles are unique regardless of the case typed" do
    @student.update!(handle: "alex_r")
    @twin.handle = "ALEX_R"
    refute @twin.valid?
    assert_includes @twin.errors[:handle], "has already been taken"

    assert_raises(ActiveRecord::RecordNotUnique) { @twin.update_column(:handle, "alex_r") }
  end

  test "the database keeps handles lowercase for writes that skip the model" do
    @student.update!(handle: "alex_r")

    # update_column still runs `normalizes`, so a mixed-case copy collides.
    assert_raises(ActiveRecord::RecordNotUnique) { User.transaction(requires_new: true) { @twin.update_column(:handle, "Alex_R") } }
    # Raw SQL skips Rails entirely; the CHECK refuses any uppercase handle.
    [ "Alex_R", "SOLO" ].each do |handle|
      error = assert_raises(ActiveRecord::StatementInvalid) do
        User.transaction(requires_new: true) do
          User.connection.exec_update("UPDATE users SET handle = #{User.connection.quote(handle)} WHERE id = #{Integer(@twin.id)}")
        end
      end
      assert_match(/users_handle_lowercase/, error.message)
    end
    assert_nil @twin.reload.handle
  end

  test "people set, change and clear their own handle in Profile" do
    as_user(@student) { patch "/api/v1/profile", params: { handle: "Alex_R" }, headers: auth_headers, as: :json }
    assert_response :success
    assert_equal "alex_r", response.parsed_body.dig("user", "handle")

    as_user(@twin) { patch "/api/v1/profile", params: { handle: "alex_r" }, headers: auth_headers, as: :json }
    assert_response :unprocessable_entity
    assert_includes response.parsed_body.fetch("errors"), "Handle has already been taken"
    assert_nil @twin.reload.handle

    as_user(@student) { get "/api/v1/profile", headers: auth_headers }
    assert_equal "alex_r", response.parsed_body.dig("user", "handle")

    as_user(@student) { patch "/api/v1/profile", params: { handle: "" }, headers: auth_headers, as: :json }
    assert_response :success
    assert_nil @student.reload.handle
  end

  test "pickers and member lists carry handles but never emails for students" do
    @student.update!(handle: "alex_r")
    @twin.update!(handle: "alex_from_maui")

    as_user(@instructor) { get "/api/v1/direct_conversations/available_users", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert_response :success
    twins = response.parsed_body.fetch("users").select { |user| user["full_name"] == "Alex Rivera" }
    assert_equal %w[alex_from_maui alex_r], twins.map { |user| user["handle"] }.sort

    as_user(@student) { get "/api/v1/workspaces/#{@cohort.workspace.id}", headers: auth_headers }
    assert_response :success
    members = response.parsed_body.dig("workspace", "members")
    assert_equal "alex_from_maui", members.find { |member| member["id"] == @twin.id }["handle"]
    assert members.none? { |member| member.key?("email") }, "Students never see emails in member lists"

    as_user(@student) { get "/api/v1/direct_conversations/available_users", params: { cohort_id: @cohort.id }, headers: auth_headers }
    assert response.parsed_body.fetch("users").none? { |user| user.key?("email") }
  end

  private

  def person(name, role, first:, last:)
    User.create!(clerk_id: "handle_#{name}", email: "handle-#{name}@example.com", first_name: first, last_name: last, role: role,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
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
