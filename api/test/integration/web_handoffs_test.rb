require "test_helper"

class WebHandoffsTest < ActionDispatch::IntegrationTest
  def setup
    @user = User.create!(clerk_id: "clerk_handoff", email: "handoff@example.com", first_name: "Mobile", last_name: "Student", role: :student)
  end

  test "authenticated users can create an allowlisted handoff" do
    service = Object.new
    expected_user = @user
    service.define_singleton_method(:create) do |user:, redirect_url:|
      raise unless user == expected_user && redirect_url.end_with?("/lessons/42")
      { success: true, url: "https://accounts.example.com/one-time" }
    end

    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }
    begin
      as_user do
        post "/api/v1/web_handoffs", params: { destination: "/lessons/42" }, headers: auth_headers, as: :json
      end
    ensure
      ClerkWebHandoffService.define_singleton_method(:new, original_new)
    end

    assert_response :success
    assert_equal "https://accounts.example.com/one-time", JSON.parse(response.body)["url"]
  end

  test "rejects external and unsupported destinations before calling Clerk" do
    as_user do
      post "/api/v1/web_handoffs", params: { destination: "https://evil.example" }, headers: auth_headers, as: :json
    end
    assert_response :unprocessable_entity
  end

  test "staff can create a handoff to a supported mobile administration fallback" do
    staff = User.create!(clerk_id: "clerk_handoff_staff", email: "handoff-staff@example.com", role: :instructor)
    destination = nil
    service = Object.new
    service.define_singleton_method(:create) do |user:, redirect_url:|
      destination = [ user, redirect_url ]
      { success: true, url: "https://accounts.example.com/staff-handoff" }
    end
    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }

    as_user(staff) do
      post "/api/v1/web_handoffs", params: { destination: "/admin/students/42" }, headers: auth_headers, as: :json
    end

    assert_response :success
    assert_equal "https://accounts.example.com/staff-handoff", JSON.parse(response.body).fetch("url")
    assert_equal [ staff, "#{FrontendUrlResolver.resolve.delete_suffix('/')}/admin/students/42" ], destination
  ensure
    ClerkWebHandoffService.define_singleton_method(:new, original_new) if defined?(original_new) && original_new
  end

  test "staff handoffs include connected intervention and student workspace records" do
    staff = User.create!(clerk_id: "clerk_connected_staff", email: "connected-staff@example.com", role: :instructor)
    service = Object.new
    service.define_singleton_method(:create) { |user:, redirect_url:| { success: true, url: "https://accounts.example.com/connected?user=#{user.id}&destination=#{redirect_url}" } }
    original_new = ClerkWebHandoffService.method(:new)
    ClerkWebHandoffService.define_singleton_method(:new) { service }

    [ "/admin/interventions/61", "/admin/help-requests/41", "/admin/submissions/31", "/admin/cohorts/4/students/18/support", "/admin/students/18?legacy=1&cohort_id=4" ].each do |destination|
      as_user(staff) { post "/api/v1/web_handoffs", params: { destination: destination }, headers: auth_headers, as: :json }
      assert_response :success, destination
    end
  ensure
    ClerkWebHandoffService.define_singleton_method(:new, original_new) if defined?(original_new) && original_new
  end

  test "students cannot create an administration handoff" do
    as_user do
      post "/api/v1/web_handoffs", params: { destination: "/admin/grading" }, headers: auth_headers, as: :json
    end

    assert_response :forbidden
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user = @user)
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) do |_token|
      { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    end
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
