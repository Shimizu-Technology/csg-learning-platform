require "test_helper"

class ClerkInvitationServiceTest < ActiveSupport::TestCase
  test "creates invitations without Clerk email and with the lifetime the Team page reports" do
    captured = nil
    response = Struct.new(:code, :parsed_response) do
      def success? = true
    end.new(200, { "id" => "inv_test", "status" => "pending", "url" => "https://example.com/invite" })
    original_post = HTTParty.method(:post)
    HTTParty.define_singleton_method(:post) do |_url, **options|
      captured = JSON.parse(options.fetch(:body))
      response
    end

    result = ClerkInvitationService.new(secret_key: "sk_test_example").create_invitation(email: "invitee@example.com", ignore_existing: true)

    assert result[:success]
    assert_equal false, captured.fetch("notify")
    assert_equal 30, captured.fetch("expires_in_days")
    assert_equal User::INVITE_LINK_LIFETIME, captured.fetch("expires_in_days").days
  ensure
    HTTParty.define_singleton_method(:post, original_post) if original_post
  end
end
