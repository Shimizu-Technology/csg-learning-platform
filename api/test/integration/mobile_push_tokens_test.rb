require "test_helper"

class MobilePushTokensTest < ActionDispatch::IntegrationTest
  def setup
    @user = User.create!(clerk_id: "mobile_user", email: "mobile@example.com", role: :student)
    @other_user = User.create!(clerk_id: "other_mobile_user", email: "other-mobile@example.com", role: :student)
  end

  test "user registers refreshes and removes an Expo push token" do
    as_user(@user) do
      post "/api/v1/mobile_push_tokens", params: { token: "ExpoPushToken[device-1]", platform: "ios", device_id: "device-id", app_version: "1.0.0" }, headers: auth_headers, as: :json
    end
    assert_response :created
    assert_equal 1, @user.mobile_push_tokens.count

    as_user(@user) do
      post "/api/v1/mobile_push_tokens", params: { token: "ExpoPushToken[device-1]", platform: "ios", device_id: "device-id", app_version: "1.0.1" }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal "1.0.1", @user.mobile_push_tokens.first.app_version

    as_user(@user) do
      delete "/api/v1/mobile_push_tokens", params: { token: "ExpoPushToken[device-1]" }, headers: auth_headers, as: :json
    end
    assert_response :no_content
    assert_empty @user.mobile_push_tokens.reload
  end

  test "token cannot be claimed by another user" do
    @user.mobile_push_tokens.create!(token: "ExpoPushToken[device-2]", platform: "ios", last_seen_at: Time.current)

    as_user(@other_user) do
      post "/api/v1/mobile_push_tokens", params: { token: "ExpoPushToken[device-2]", platform: "ios" }, headers: auth_headers, as: :json
    end

    assert_response :conflict
    assert_equal @user, MobilePushToken.find_by!(token: "ExpoPushToken[device-2]").user
  end

  private

  def auth_headers
    { "Authorization" => "Bearer test_token" }
  end

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email }
    original_verify = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify)
  end
end
