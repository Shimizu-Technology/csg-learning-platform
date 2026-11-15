require "test_helper"

class OpenapiProductionErrorsTest < ActionDispatch::IntegrationTest
  test "production middleware returns minimal JSON for missing records" do
    admin = User.create!(clerk_id: "contract_missing_admin", email: "contract-missing@example.com", role: :admin)
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| { "sub" => admin.clerk_id, "email" => admin.email } }
    old_details = Rails.application.env_config["action_dispatch.show_detailed_exceptions"]
    old_show = Rails.application.env_config["action_dispatch.show_exceptions"]
    Rails.application.env_config["action_dispatch.show_detailed_exceptions"] = false
    Rails.application.env_config["action_dispatch.show_exceptions"] = :all

    get "/api/v1/users/0", headers: { "Authorization" => "Bearer test", "Accept" => "application/json" }
    assert_response :not_found
    assert_equal({ "status" => 404, "error" => "Not Found" }, response.parsed_body)

    get "/api/v1/users/0", headers: { "Authorization" => "Bearer test" }
    assert_response :not_found
    assert_empty response.body
  ensure
    ClerkAuth.define_singleton_method(:verify, original) if original
    Rails.application.env_config["action_dispatch.show_detailed_exceptions"] = old_details
    Rails.application.env_config["action_dispatch.show_exceptions"] = old_show
  end
end
