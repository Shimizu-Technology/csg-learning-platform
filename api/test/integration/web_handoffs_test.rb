require "test_helper"

class WebHandoffsTest < ActionDispatch::IntegrationTest
  def setup
    @user = User.create!(clerk_id: "clerk_handoff", email: "handoff@example.com", first_name: "Mobile", last_name: "Student", role: :student)
  end

  test "authenticated users can create an allowlisted handoff" do
    service = Object.new
    service.define_singleton_method(:create) do |user_id:, redirect_url:|
      raise unless user_id == "clerk_handoff" && redirect_url.end_with?("/lessons/42")
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

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) do |_token|
      { "sub" => "clerk_handoff", "email" => "handoff@example.com", "first_name" => "Mobile", "last_name" => "Student" }
    end
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
