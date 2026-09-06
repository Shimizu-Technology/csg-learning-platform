require "test_helper"

class ExpoPushReceiptServiceTest < ActiveSupport::TestCase
  setup do
    user = User.create!(clerk_id: "expo_receipt_user", email: "expo-receipt@example.com", role: :student)
    @token = user.mobile_push_tokens.create!(token: "ExpoPushToken[receipt-device]", platform: "ios", last_seen_at: Time.current)
    @request = { "receipt_id" => "receipt-1", "mobile_push_token_id" => @token.id }
  end

  test "marks a token failed when its delivery receipt says the device is unregistered" do
    response = http_response(Net::HTTPOK, 200, data: { "receipt-1" => { status: "error", details: { error: "DeviceNotRegistered" } } })

    with_http_response(response) do |connection|
      assert_empty ExpoPushReceiptService.new.check([ @request ])
      assert_equal [ "receipt-1" ], JSON.parse(connection.request_received.body).fetch("ids")
      assert connection.use_ssl
      assert_equal ExpoPushReceiptService::OPEN_TIMEOUT, connection.open_timeout
      assert_equal ExpoPushReceiptService::READ_TIMEOUT, connection.read_timeout
    end

    assert @token.reload.failed_at.present?
  end

  test "keeps a missing receipt for one later lookup" do
    response = http_response(Net::HTTPOK, 200, data: {})

    with_http_response(response) do
      assert_equal [ @request ], ExpoPushReceiptService.new.check([ @request ])
    end

    assert_nil @token.reload.failed_at
  end

  test "does not disable a token for a provider or payload error" do
    response = http_response(Net::HTTPOK, 200, data: { "receipt-1" => { status: "error", details: { error: "InvalidCredentials" } } })

    with_http_response(response) do
      assert_empty ExpoPushReceiptService.new.check([ @request ])
    end

    assert_nil @token.reload.failed_at
  end

  test "raises a retryable error for timeouts, throttling, and server failures" do
    [ [ Net::HTTPRequestTimeout, 408 ], [ Net::HTTPTooManyRequests, 429 ], [ Net::HTTPServiceUnavailable, 503 ] ].each do |response_class, code|
      response = http_response(response_class, code, errors: [])

      with_http_response(response) do
        assert_raises(ExpoPushReceiptService::RetryableError) { ExpoPushReceiptService.new.check([ @request ]) }
      end
    end
  end

  test "raises a terminal error instead of treating a client failure as an empty receipt map" do
    response = http_response(Net::HTTPUnauthorized, 401, errors: [])

    with_http_response(response) do
      assert_raises(ExpoPushReceiptService::TerminalError) { ExpoPushReceiptService.new.check([ @request ]) }
    end
  end

  test "raises a retryable error for a malformed receipt map" do
    response = http_response(Net::HTTPOK, 200, data: [])

    with_http_response(response) do
      assert_raises(ExpoPushReceiptService::RetryableError) { ExpoPushReceiptService.new.check([ @request ]) }
    end
  end

  private

  def http_response(response_class, code, body)
    response = response_class.new("1.1", code.to_s, "Response")
    response.instance_variable_set(:@read, true)
    response.body = body.to_json
    response
  end

  def with_http_response(response)
    connection = Struct.new(:use_ssl, :open_timeout, :read_timeout) do
      attr_accessor :request_received, :response

      def request(request)
        self.request_received = request
        response
      end

      def start
        yield self
      end
    end.new
    connection.response = response

    original_new = Net::HTTP.method(:new)
    Net::HTTP.define_singleton_method(:new) { |*| connection }
    yield connection
  ensure
    Net::HTTP.define_singleton_method(:new, original_new) if original_new
  end
end
