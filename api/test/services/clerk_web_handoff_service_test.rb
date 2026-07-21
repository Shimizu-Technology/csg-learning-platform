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

  private

  def with_http_response(response)
    original_post = HTTParty.method(:post)
    HTTParty.define_singleton_method(:post) { |_url, **_options| response }
    yield
  ensure
    HTTParty.define_singleton_method(:post, original_post)
  end
end
