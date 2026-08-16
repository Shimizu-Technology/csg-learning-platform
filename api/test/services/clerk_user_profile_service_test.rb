require "test_helper"

class ClerkUserProfileServiceTest < ActiveSupport::TestCase
  test "uses the secret belonging to the token issuer and returns verified identity data" do
    environment = ClerkEnvironment.new(name: "production", issuer: "https://prod.clerk.test", secret_key: "sk_live_test")
    response = Struct.new(:parsed_response) { def success? = true }.new(
      {
        "primary_email_address_id" => "email_primary",
        "email_addresses" => [
          { "id" => "email_primary", "email_address" => "Student@Example.com", "verification" => { "status" => "verified" } }
        ],
        "first_name" => "Student",
        "last_name" => "One",
        "external_id" => "42"
      }
    )
    authorization = nil

    original_environment_lookup = ClerkEnvironment.method(:for_issuer)
    original_get = HTTParty.method(:get)
    ClerkEnvironment.define_singleton_method(:for_issuer) { |_issuer| environment }
    HTTParty.define_singleton_method(:get) do |_url, headers:, **_options|
      authorization = headers["Authorization"]
      response
    end

    profile = ClerkUserProfileService.new.fetch(issuer: environment.issuer, clerk_user_id: "user_prod")
    assert_equal "Bearer sk_live_test", authorization
    assert_equal "student@example.com", profile[:email]
    assert profile[:email_verified]
    assert_equal "42", profile[:external_id]
  ensure
    ClerkEnvironment.define_singleton_method(:for_issuer, original_environment_lookup) if defined?(original_environment_lookup) && original_environment_lookup
    HTTParty.define_singleton_method(:get, original_get) if defined?(original_get) && original_get
  end


  test "rejects a malformed Clerk subject before making a request" do
    environment = ClerkEnvironment.new(name: "production", issuer: "https://prod.clerk.test", secret_key: "sk_live_test")
    original_environment_lookup = ClerkEnvironment.method(:for_issuer)
    original_get = HTTParty.method(:get)
    ClerkEnvironment.define_singleton_method(:for_issuer) { |_issuer| environment }
    HTTParty.define_singleton_method(:get) { |_url, **_options| raise "unexpected request" }

    assert_nil ClerkUserProfileService.new.fetch(issuer: environment.issuer, clerk_user_id: "../user_prod")
  ensure
    ClerkEnvironment.define_singleton_method(:for_issuer, original_environment_lookup) if defined?(original_environment_lookup) && original_environment_lookup
    HTTParty.define_singleton_method(:get, original_get) if defined?(original_get) && original_get
  end


  test "rejects a profile without an exact primary email" do
    environment = ClerkEnvironment.new(name: "production", issuer: "https://prod.clerk.test", secret_key: "sk_live_test")
    response = Struct.new(:parsed_response) { def success? = true }.new(
      {
        "primary_email_address_id" => nil,
        "email_addresses" => [
          { "id" => "email_secondary", "email_address" => "student@example.com", "verification" => { "status" => "verified" } }
        ]
      }
    )
    original_environment_lookup = ClerkEnvironment.method(:for_issuer)
    original_get = HTTParty.method(:get)
    ClerkEnvironment.define_singleton_method(:for_issuer) { |_issuer| environment }
    HTTParty.define_singleton_method(:get) { |_url, **_options| response }

    assert_nil ClerkUserProfileService.new.fetch(issuer: environment.issuer, clerk_user_id: "user_prod")
  ensure
    ClerkEnvironment.define_singleton_method(:for_issuer, original_environment_lookup) if defined?(original_environment_lookup) && original_environment_lookup
    HTTParty.define_singleton_method(:get, original_get) if defined?(original_get) && original_get
  end
end
