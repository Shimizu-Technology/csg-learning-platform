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
      delete "/api/v1/mobile_push_tokens?token=ExpoPushToken%5Bdevice-1%5D", headers: auth_headers
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

  test "user reads and changes the mobile push preference" do
    @user.mobile_push_tokens.create!(token: "ExpoPushToken[preference]", platform: "ios", last_seen_at: Time.current)
    @user.mobile_push_tokens.create!(token: "ExpoPushToken[preference-failed]", platform: "ios", last_seen_at: Time.current, failed_at: Time.current)

    as_user(@user) do
      get "/api/v1/mobile_push_tokens/config", headers: auth_headers
    end
    assert_response :success
    assert_equal true, response.parsed_body["notifications_enabled"]
    assert_equal 1, response.parsed_body["active_device_count"]

    as_user(@user) do
      patch "/api/v1/mobile_push_tokens/preferences", params: { notifications_enabled: false }, headers: auth_headers, as: :json
    end
    assert_response :success
    assert_equal false, response.parsed_body["notifications_enabled"]
    refute @user.reload.mobile_push_notifications_enabled?
  end

  test "mobile push preference requires authentication" do
    get "/api/v1/mobile_push_tokens/config"
    assert_response :unauthorized

    patch "/api/v1/mobile_push_tokens/preferences", params: { notifications_enabled: false }, as: :json
    assert_response :unauthorized
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
