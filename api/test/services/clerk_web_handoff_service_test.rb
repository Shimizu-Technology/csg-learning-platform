require "test_helper"

class ClerkWebHandoffServiceTest < ActiveSupport::TestCase
  test "creates a one minute Clerk link with an internal redirect" do
    response = Object.new
    response.define_singleton_method(:success?) { true }
    response.define_singleton_method(:parsed_response) { { "url" => "https://accounts.example.com/sign-in?ticket=secret" } }

    with_http_response(response) do
      result = ClerkWebHandoffService.new(secret_key: "sk_test").create(
        user_id: "user_123",
        redirect_url: "https://learn.codeschoolofguam.com/lessons/42"
      )

      assert result[:success]
      uri = URI.parse(result[:url])
      params = URI.decode_www_form(uri.query).to_h
      assert_equal "secret", params["ticket"]
      assert_equal "https://learn.codeschoolofguam.com/lessons/42", params["redirect_url"]
    end
  end

  test "does not expose Clerk response details when URL creation fails" do
    response = Object.new
    response.define_singleton_method(:success?) { false }
    response.define_singleton_method(:code) { 422 }
    response.define_singleton_method(:parsed_response) { { "errors" => [ { "message" => "no" } ] } }
    with_http_response(response) do
      result = ClerkWebHandoffService.new(secret_key: "sk_test").create(user_id: "user_123", redirect_url: "https://example.com")
      assert_equal false, result[:success]
      assert_equal ClerkWebHandoffService::GENERIC_ERROR, result[:error]
    end
  end

  test "fails safely when the secret is missing" do
    result = ClerkWebHandoffService.new(secret_key: nil).create(user_id: "user_123", redirect_url: "https://example.com")
    assert_equal({ success: false, error: ClerkWebHandoffService::GENERIC_ERROR }, result)
  end

  test "rejects a non HTTPS handoff URL" do
    response = Object.new
    response.define_singleton_method(:success?) { true }
    response.define_singleton_method(:parsed_response) { { "url" => "http://accounts.example.com/sign-in?ticket=secret" } }
    with_http_response(response) do
      result = ClerkWebHandoffService.new(secret_key: "sk_test").create(user_id: "user_123", redirect_url: "https://example.com")
      assert_equal({ success: false, error: ClerkWebHandoffService::GENERIC_ERROR }, result)
    end
  end

  test "fails safely when Clerk returns a malformed success payload" do
    response = Object.new
    response.define_singleton_method(:success?) { true }
    response.define_singleton_method(:parsed_response) { nil }
    with_http_response(response) do
      result = ClerkWebHandoffService.new(secret_key: "sk_test").create(user_id: "user_123", redirect_url: "https://example.com")
      assert_equal({ success: false, error: ClerkWebHandoffService::GENERIC_ERROR }, result)
    end
  end

  test "uses the primary environment identity for a user" do
    user = User.create!(clerk_id: "dev_handoff", email: "prod-handoff@example.com", role: :student)
    environment = ClerkEnvironment.new(name: "production", issuer: "https://prod.clerk.test", secret_key: "sk_live_test")
    user.clerk_identities.create!(issuer: environment.issuer, clerk_user_id: "prod_handoff")
    posted_user_id = nil
    response = Object.new
    response.define_singleton_method(:success?) { true }
    response.define_singleton_method(:parsed_response) { { "url" => "https://accounts.example.com/sign-in?ticket=secret" } }

    original_post = HTTParty.method(:post)
    HTTParty.define_singleton_method(:post) do |_url, **options|
      posted_user_id = JSON.parse(options.fetch(:body)).fetch("user_id")
      response
    end

    result = ClerkWebHandoffService.new(environment: environment).create(user: user, redirect_url: "https://learn.codeschoolofguam.com/lessons/42")
    assert result[:success]
    assert_equal "prod_handoff", posted_user_id
  ensure
    HTTParty.define_singleton_method(:post, original_post) if defined?(original_post) && original_post
  end

  test "fails safely when the user has not been provisioned in the primary environment" do
    user = User.create!(clerk_id: "dev_only", email: "dev-only@example.com", role: :student)
    environment = ClerkEnvironment.new(name: "production", issuer: "https://prod.clerk.test", secret_key: "sk_live_test")

    result = ClerkWebHandoffService.new(environment: environment).create(user: user, redirect_url: "https://learn.codeschoolofguam.com/lessons/42")
    assert_equal({ success: false, error: ClerkWebHandoffService::GENERIC_ERROR }, result)
  end

  private

  def with_http_response(response)
    original_post = HTTParty.method(:post)
    HTTParty.define_singleton_method(:post) { |_url, **_options| response }
    yield
  ensure
    HTTParty.define_singleton_method(:post, original_post)
  end
end
