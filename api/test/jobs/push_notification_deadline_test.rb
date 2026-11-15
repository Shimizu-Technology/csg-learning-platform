require "test_helper"

# A provider deadline can stop a message push in two different places:
# - before a request starts: nothing reached the device, so the notification's
#   provider claim is released and the next attempt sends it;
# - after a request starts: it may have reached the device, so the claim stays
#   and the next attempt does not send it again (at most once).
class PushNotificationDeadlineTest < ActiveJob::TestCase
  WEB_PUSH_ENV = { "WEB_PUSH_PUBLIC_KEY" => "public", "WEB_PUSH_PRIVATE_KEY" => "private", "WEB_PUSH_SUBJECT" => "mailto:push@example.com" }.freeze

  setup do
    curriculum = Curriculum.create!(name: "Push deadline")
    cohort = Cohort.create!(curriculum: curriculum, name: "Push deadline cohort", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "deadline_author", email: "deadline-author@example.com", role: :admin)
    @stalled_user = User.create!(clerk_id: "deadline_stalled", email: "deadline-stalled@example.com", role: :student, web_push_notifications_enabled: true)
    @waiting_user = User.create!(clerk_id: "deadline_waiting", email: "deadline-waiting@example.com", role: :student, web_push_notifications_enabled: true)
    [ @stalled_user, @waiting_user ].each { |user| Enrollment.create!(user: user, cohort: cohort, status: :active) }
    @message = Message.create!(channel: channel, author: author, body: "Deadline")
    notifications = NotificationDeliveryService.message_created(@message)
    @stalled_notification = notifications.find { |notification| notification.user_id == @stalled_user.id }
    @waiting_notification = notifications.find { |notification| notification.user_id == @waiting_user.id }
    assert_operator @stalled_notification.id, :<, @waiting_notification.id, "the stalled recipient's request is sent first"
    @notification_ids = [ @stalled_notification.id, @waiting_notification.id ]
  end

  test "web push retries a request the deadline left unstarted and never resends one that started" do
    stalled = @stalled_user.push_subscriptions.create!(endpoint: "https://push.example/stalled", p256dh: "key", auth: "auth")
    waiting = @waiting_user.push_subscriptions.create!(endpoint: "https://push.example/waiting", p256dh: "key", auth: "auth")
    attempts = Queue.new
    stall = true
    send_push = lambda do |endpoint:, **|
      attempts << endpoint
      # A response that trickles in forever: only the batch deadline stops it.
      sleep 30 if stall && endpoint == stalled.endpoint
    end

    with_web_push(send_push) do
      # One worker: the stalled request holds it until the deadline, so the
      # second request is never started.
      with_constants(WebPushNotificationService, MAX_CONCURRENT_DELIVERIES: 1, BATCH_DEADLINE: 0.3, WORKER_GRACE: 0.1, KILL_GRACE: 0.1) do
        error = assert_raises(PushDeliveryNotStarted) { PushNotificationJob.perform_now("Message", @message.id, @notification_ids) }
        assert_equal [ @waiting_notification.id ], error.notification_ids
        assert_equal [ stalled.endpoint ], drain(attempts)
        assert_equal [ @stalled_notification.id ], @message.reload.web_push_attempted_notification_ids,
          "the started request keeps its claim; the unstarted one is released"

        stall = false
        PushNotificationJob.perform_now("Message", @message.id, @notification_ids)
      end
    end

    assert_equal [ waiting.endpoint ], drain(attempts), "only the never-started request is sent on the next attempt"
    assert_equal @notification_ids.sort, @message.reload.web_push_attempted_notification_ids.sort
    assert_nil stalled.reload.failed_at
    assert_nil waiting.reload.failed_at
  end

  test "Expo retries batches the deadline left unstarted and never resends one that started" do
    stalled_token = @stalled_user.mobile_push_tokens.create!(token: "ExpoPushToken[stalled]", platform: "ios", last_seen_at: 1.day.ago)
    waiting_token = @waiting_user.mobile_push_tokens.create!(token: "ExpoPushToken[waiting]", platform: "ios", last_seen_at: 1.day.ago)
    requested_tokens = []
    stall = true
    respond = lambda do |request|
      tokens = JSON.parse(request.body).map { |payload| payload.fetch("to") }
      requested_tokens.concat(tokens)
      sleep 30 if stall && tokens.include?(stalled_token.token)
      ok_response(tokens.size)
    end

    with_expo(respond) do
      # One token per batch: the stalled batch runs into the deadline, so the
      # next batch is never started.
      with_constants(ExpoPushNotificationService, BATCH_SIZE: 1, DELIVERY_DEADLINE: 0.3) do
        error = assert_raises(PushDeliveryNotStarted) { PushNotificationJob.perform_now("Message", @message.id, @notification_ids) }
        assert_equal [ @waiting_notification.id ], error.notification_ids
        assert_equal [ stalled_token.token ], requested_tokens
        assert_equal [ @stalled_notification.id ], @message.reload.expo_push_attempted_notification_ids

        stall = false
        PushNotificationJob.perform_now("Message", @message.id, @notification_ids)
      end
    end

    assert_equal [ stalled_token.token, waiting_token.token ], requested_tokens, "only the never-started batch is sent on the next attempt"
    assert_equal @notification_ids.sort, @message.reload.expo_push_attempted_notification_ids.sort
    assert_nil stalled_token.reload.failed_at
  end

  test "a request that started and ran out of time is not retried even when nothing else was sent" do
    stalled = @stalled_user.push_subscriptions.create!(endpoint: "https://push.example/only-stalled", p256dh: "key", auth: "auth")
    attempts = Queue.new
    send_push = lambda do |endpoint:, **|
      attempts << endpoint
      sleep 30
    end

    with_web_push(send_push) do
      with_constants(WebPushNotificationService, BATCH_DEADLINE: 0.2, WORKER_GRACE: 0.1, KILL_GRACE: 0.1) do
        2.times { PushNotificationJob.perform_now("Message", @message.id, [ @stalled_notification.id ]) }
      end
    end

    assert_equal [ stalled.endpoint ], drain(attempts)
    assert_equal [ @stalled_notification.id ], @message.reload.web_push_attempted_notification_ids
  end

  private

  def drain(queue)
    Array.new(queue.size) { queue.pop }
  end

  def ok_response(count)
    response = Net::HTTPOK.new("1.1", "200", "OK")
    response.instance_variable_set(:@read, true)
    response.body = { data: Array.new(count) { { status: "ok" } } }.to_json
    response
  end

  def with_web_push(send_push)
    original = WebPush.method(:payload_send)
    WebPush.define_singleton_method(:payload_send) { |**kwargs| send_push.call(**kwargs) }
    WEB_PUSH_ENV.each { |key, value| ENV[key] = value }
    yield
  ensure
    WEB_PUSH_ENV.each_key { |key| ENV.delete(key) }
    WebPush.define_singleton_method(:payload_send, original) if original
  end

  def with_expo(respond)
    connection = Struct.new(:use_ssl, :open_timeout, :read_timeout, :write_timeout) do
      attr_accessor :responder

      def request(request) = responder.call(request)

      def start
        yield self
      end
    end.new
    connection.responder = respond
    original_new = Net::HTTP.method(:new)
    Net::HTTP.define_singleton_method(:new) { |*| connection }
    yield
  ensure
    Net::HTTP.define_singleton_method(:new, original_new) if original_new
  end

  def with_constants(owner, **values)
    originals = values.keys.index_with { |name| owner.const_get(name) }
    replace_constants(owner, values)
    yield
  ensure
    replace_constants(owner, originals) if originals
  end

  def replace_constants(owner, values)
    values.each do |name, value|
      owner.send(:remove_const, name)
      owner.const_set(name, value)
    end
  end
end
