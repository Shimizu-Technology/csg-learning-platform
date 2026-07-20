require "test_helper"

class ExpoPushNotificationServiceTest < ActiveSupport::TestCase
  test "sends one personalized payload for each active device" do
    user = User.create!(clerk_id: "expo_recipient", email: "expo-recipient@example.com", role: :student)
    user.mobile_push_tokens.create!(token: "ExpoPushToken[device-1]", platform: "ios", last_seen_at: 1.day.ago)
    announcement = Announcement.create!(title: "Test announcement", body: "Test", author: user, audience: :global, status: :published)
    notification = user.notifications.create!(notifiable: announcement, notification_type: :message, title: "New message", body: "Can you review this?", path: "/messages/1")
    request_payload = nil
    response = Net::HTTPOK.new("1.1", "200", "OK")
    response.instance_variable_set(:@read, true)
    response.body = { data: [ { status: "ok", id: "receipt-1" } ] }.to_json

    with_http_response(response) do |connection|
      delivered = ExpoPushNotificationService.new.deliver_notifications([ notification ]) do |item|
        { title: item.title, body: item.body, data: { path: item.path } }
      end
      assert delivered
      request_payload = JSON.parse(connection.request_received.body)
      assert connection.use_ssl
      assert_equal ExpoPushNotificationService::OPEN_TIMEOUT, connection.open_timeout
      assert_equal ExpoPushNotificationService::READ_TIMEOUT, connection.read_timeout
    end

    assert_equal "ExpoPushToken[device-1]", request_payload.first.fetch("to")
    assert_equal "Can you review this?", request_payload.first.fetch("body")
    assert user.mobile_push_tokens.first.last_seen_at > 1.hour.ago
  end

  test "marks an unregistered device as failed" do
    user = User.create!(clerk_id: "expo_failed", email: "expo-failed@example.com", role: :student)
    token = user.mobile_push_tokens.create!(token: "ExpoPushToken[failed-device]", platform: "ios", last_seen_at: Time.current)
    announcement = Announcement.create!(title: "Failed token test", body: "Test", author: user, audience: :global, status: :published)
    notification = user.notifications.create!(notifiable: announcement, notification_type: :message, title: "New message", body: "Hello", path: "/messages/1")
    response = Net::HTTPOK.new("1.1", "200", "OK")
    response.instance_variable_set(:@read, true)
    response.body = { data: [ { status: "error", details: { error: "DeviceNotRegistered" } } ] }.to_json

    with_http_response(response) do |_connection|
      ExpoPushNotificationService.new.deliver_notifications([ notification ]) { { title: "Test", body: "Test" } }
    end

    assert token.reload.failed_at.present?
  end

  test "reuses one HTTPS connection across push batches" do
    user = User.create!(clerk_id: "expo_batches", email: "expo-batches@example.com", role: :student)
    101.times do |index|
      user.mobile_push_tokens.create!(token: "ExpoPushToken[batch-#{index}]", platform: "ios", last_seen_at: Time.current)
    end
    announcement = Announcement.create!(title: "Batch test", body: "Test", author: user, audience: :global, status: :published)
    notification = user.notifications.create!(notifiable: announcement, notification_type: :announcement, title: "Batch", body: "Test", path: "/updates")
    response = Net::HTTPOK.new("1.1", "200", "OK")
    response.instance_variable_set(:@read, true)
    response.body = { data: Array.new(100) { { status: "ok" } } }.to_json

    with_http_response(response) do |connection|
      ExpoPushNotificationService.new.deliver_notifications([ notification ]) { { title: "Test", body: "Test" } }
      assert_equal 1, connection.start_count
      assert_equal 2, connection.request_count
    end
  end

  private

  def with_http_response(response)
    connection = Struct.new(:use_ssl, :open_timeout, :read_timeout) do
      attr_accessor :request_received, :request_count, :response, :start_count

      def request(request)
        self.request_received = request
        self.request_count = request_count.to_i + 1
        response
      end

      def start
        self.start_count = start_count.to_i + 1
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
