require "test_helper"

class MobilePushTokenTest < ActiveSupport::TestCase
  test "accepts current and legacy Expo token formats" do
    user = User.create!(clerk_id: "mobile_token_user", email: "mobile-token@example.com", role: :student)

    assert MobilePushToken.new(user: user, token: "ExpoPushToken[abc123]", platform: "ios", last_seen_at: Time.current).valid?
    assert MobilePushToken.new(user: user, token: "ExponentPushToken[abc456]", platform: "android", last_seen_at: Time.current).valid?
  end

  test "rejects arbitrary endpoints" do
    user = User.create!(clerk_id: "invalid_mobile_token_user", email: "invalid-mobile-token@example.com", role: :student)
    token = MobilePushToken.new(user: user, token: "https://example.com", platform: "ios", last_seen_at: Time.current)

    refute token.valid?
    assert_includes token.errors[:token], "must be an Expo push token"
  end
end
