require "test_helper"
require_relative "../support/after_commit_helpers"

# Large publications return before fan-out even with ordinary jobs inline.
# Drain the captured fan-out explicitly, then verify bounded provider concurrency
# with each external call stubbed to take PUSH_LATENCY.
class AnnouncementFanOutTimingTest < ActionDispatch::IntegrationTest
  include AfterCommitHelpers

  RECIPIENTS = 200
  PUSH_LATENCY = Float(ENV.fetch("FAN_OUT_LATENCY", "0.05"))
  WEB_PUSH_ENV = { "WEB_PUSH_PUBLIC_KEY" => "public", "WEB_PUSH_PRIVATE_KEY" => "private", "WEB_PUSH_SUBJECT" => "mailto:push@example.com" }.freeze

  class FakeExpoConnection
    attr_reader :requests

    def initialize(latency)
      @latency = latency
      @requests = 0
    end

    def start
      yield self
    end

    def request(request)
      @requests += 1
      sleep @latency
      response = Net::HTTPOK.new("1.1", "200", "OK")
      response.instance_variable_set(:@read, true)
      response.body = { data: JSON.parse(request.body).map { { status: "ok" } } }.to_json
      response
    end
  end

  setup do
    @author = User.create!(clerk_id: "fan_out_author", email: "fan-out-author@example.com", first_name: "Ada", last_name: "Admin", role: :admin,
      community_terms_accepted_at: Time.current, community_terms_version: CommunityPolicy::VERSION)
    now = Time.current
    User.insert_all(Array.new(RECIPIENTS - 1) do |index|
      { clerk_id: "fan_out_staff_#{index}", email: "fan-out-staff-#{index}@example.com", role: User.roles[:instructor], created_at: now, updated_at: now }
    end)
    recipients = User.where(role: [ User.roles[:instructor], User.roles[:admin] ]).not_archived
    PushSubscription.insert_all(recipients.pluck(:id).map do |user_id|
      { user_id: user_id, endpoint: "https://push.example/#{user_id}", p256dh: "key-#{user_id}", auth: "auth-#{user_id}", created_at: now, updated_at: now }
    end)
    MobilePushToken.insert_all(recipients.pluck(:id).map do |user_id|
      { user_id: user_id, token: "ExpoPushToken[fan-out-#{user_id}]", platform: "ios", last_seen_at: now, created_at: now, updated_at: now }
    end)
    @recipient_count = recipients.count
    WEB_PUSH_ENV.each { |key, value| ENV[key] = value }
  end

  teardown { WEB_PUSH_ENV.each_key { |key| ENV.delete(key) } }

  test "a 200-recipient announcement sends every push without one serial call per subscription" do
    assert_equal RECIPIENTS, @recipient_count
    web_pushes = Queue.new
    in_flight = 0
    max_in_flight = 0
    web_push_seconds = 0.0
    counter = Mutex.new
    expo = FakeExpoConnection.new(PUSH_LATENCY)
    original_build_connection = ExpoPushNotificationService.instance_method(:build_connection)
    ExpoPushNotificationService.define_method(:build_connection) { expo }

    elapsed = nil
    with_inline_jobs do
      stub_web_push = lambda do |endpoint:, **|
        counter.synchronize { max_in_flight = [ max_in_flight, in_flight += 1 ].max }
        call_started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        sleep PUSH_LATENCY
        web_pushes << endpoint
      ensure
        counter.synchronize do
          in_flight -= 1
          web_push_seconds += Process.clock_gettime(Process::CLOCK_MONOTONIC) - call_started if call_started
        end
      end
      record_external_calls(WebPush, :payload_send, returns: stub_web_push) do
        started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
        as_user(@author) do
          post "/api/v1/announcements", params: { title: "Campus closed", body: "Storm day.", audience: "staff", status: "published", send_push: true }, headers: auth_headers, as: :json
        end
        elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
        assert_equal 0, Notification.where(notifiable_type: "Announcement").count
        AnnouncementFanoutJob.perform_now(response.parsed_body.dig("announcement", "id"))
      end
    end

    assert_response :created
    announcement = Announcement.find(response.parsed_body.dig("announcement", "id"))
    assert_equal RECIPIENTS, Notification.where(notifiable: announcement).count
    assert_equal RECIPIENTS, web_pushes.size
    assert_equal RECIPIENTS, Array.new(web_pushes.size) { web_pushes.pop }.uniq.size
    assert_equal 2, expo.requests, "Expo takes 100 devices per request"
    assert_equal WebPushNotificationService::MAX_CONCURRENT_DELIVERIES, max_in_flight

    # Timers can overshoot (macOS coalesces them for background processes), so
    # compare with the time the stubbed calls actually took, which is what one
    # call after another would have cost.
    serial_web_push = web_push_seconds
    puts format("\n[fan-out] %d recipients, %.0fms stubbed latency (measured %.0fms per call): request %.2fs; web push calls one after another would take %.2fs",
      RECIPIENTS, PUSH_LATENCY * 1000, web_push_seconds / RECIPIENTS * 1000, elapsed, serial_web_push) if ENV["FAN_OUT_TIMING"]
    assert_operator elapsed, :<, serial_web_push / 2, "announcement request took #{elapsed.round(2)}s"
  ensure
    ExpoPushNotificationService.define_method(:build_connection, original_build_connection) if original_build_connection
  end

  private

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
