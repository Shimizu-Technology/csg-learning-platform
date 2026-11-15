require "test_helper"

class RateLimitsTest < ActionDispatch::IntegrationTest
  test "public catalog returns JSON 429 keyed by forwarded client address" do
    headers = { "REMOTE_ADDR" => "10.0.0.2", "X-Forwarded-For" => "198.51.100.10, 10.0.0.1" }
    ApiRateLimits::STORE.write("rate-limit:public-api:catalog:198.51.100.10", 300, expires_in: 1.minute)
    get "/api/v1/course_offerings", headers: headers
    assert_response :too_many_requests
    assert_equal({ "error" => "Too many requests", "retry_after" => 60 }, response.parsed_body)
    assert_equal "60", response.headers["Retry-After"]
    get "/api/v1/course_offerings", headers: headers.merge("X-Forwarded-For" => "198.51.100.11, 10.0.0.1")
    assert_response :success
  end

  test "webhook verification and signed retries bypass general limits" do
    previous = ENV["STRIPE_WEBHOOK_SECRET"]
    secret = "whsec_synthetic_rate_limit_test"
    ENV["STRIPE_WEBHOOK_SECRET"] = secret
    ApiRateLimits::STORE.write("rate-limit:public-api:catalog:198.51.100.10", 301, expires_in: 1.minute)
    payload = { id: "evt_synthetic", type: "synthetic.noop", data: { object: {} } }.to_json
    headers = { "CONTENT_TYPE" => "application/json", "X-Forwarded-For" => "198.51.100.10" }
    post "/api/v1/course_checkout_webhooks", params: payload, headers: headers
    assert_response :bad_request
    timestamp = Time.current
    signature = Stripe::Webhook::Signature.compute_signature(timestamp, payload, secret)
    3.times do
      post "/api/v1/course_checkout_webhooks", params: payload,
        headers: headers.merge("Stripe-Signature" => "t=#{timestamp.to_i},v1=#{signature}")
      assert_response :success
    end
  ensure
    ENV["STRIPE_WEBHOOK_SECRET"] = previous
  end
end
