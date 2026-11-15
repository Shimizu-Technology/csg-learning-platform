require "test_helper"

class WebPushNotificationServiceTest < ActiveSupport::TestCase
  test "announcement push payloads identify the author and include the details" do
    author = User.create!(clerk_id: "web_announcement_author", email: "web-announcement-author@example.com", first_name: "Maya", last_name: "Santos", role: :instructor)
    announcement = Announcement.create!(title: "Office hours moved", body: "Meet in the main classroom.", author: author, audience: :global, status: :published)
    notification = author.notifications.create!(notifiable: announcement, notification_type: :announcement, title: announcement.title, body: announcement.body, path: "/updates")
    payload = nil
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_notifications) { |_notifications, raw_payload| payload = JSON.parse(raw_payload) }

    service.announcement_published(announcement, [ notification ])

    assert_equal "Office hours moved", payload.fetch("title")
    assert_equal "Maya Santos · Meet in the main classroom.", payload.fetch("body")
  end

  test "message push payloads use notification body for array inputs" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "push_author", email: "push-author@example.com", first_name: "Push", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "push_recipient", email: "push-recipient@example.com", first_name: "Push", last_name: "Recipient", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)

    message = Message.create!(channel: channel, author: author, body: "")
    message.message_attachments.create!(
      uploaded_by: author,
      s3_key: "message_attachments/channel_#{channel.id}/sample.png",
      filename: "sample.png",
      content_type: "image/png",
      byte_size: 1024
    )

    payload = nil
    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }

    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_user) do |_user_id, raw_payload|
      payload = JSON.parse(raw_payload)
    end

    service.message_created(message, [ notification ])

    assert_equal "Sent an attachment", payload.fetch("body")
    assert_equal message.id, payload.fetch("message_id")
    assert_equal message.id, payload.dig("destination", "anchor", "message_id")
  end

  test "message and announcement pushes show plain text instead of Markdown (M-8)" do
    curriculum = Curriculum.create!(name: "Bootcamp 2026")
    cohort = Cohort.create!(curriculum: curriculum, name: "Cohort 3", start_date: Date.current, status: :active)
    channel = cohort.channels.find_by!(name: "Class Chat")
    author = User.create!(clerk_id: "md_push_author", email: "md-push-author@example.com", first_name: "Md", last_name: "Author", role: :admin)
    recipient = User.create!(clerk_id: "md_push_recipient", email: "md-push-recipient@example.com", first_name: "Md", last_name: "Recipient", role: :student)
    Enrollment.create!(user: recipient, cohort: cohort, status: :active)
    message = Message.create!(channel: channel, author: author, body: "**What `git init` does:** makes a repo.\n\n```bash\nls -a\n```")
    notification = NotificationDeliveryService.message_created(message).find { |item| item.user_id == recipient.id }
    payloads = []
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_user) { |_user_id, raw_payload| payloads << JSON.parse(raw_payload) }
    service.define_singleton_method(:deliver_to_notifications) { |_notifications, raw_payload| payloads << JSON.parse(raw_payload) }

    service.message_created(message, [ notification ])
    announcement = Announcement.create!(title: "Setup", body: "Run **`bin/rails db:migrate`** first.", author: author, audience: :global, status: :published)
    service.announcement_published(announcement, [])

    assert_equal "What git init does: makes a repo. ls -a", payloads.first.fetch("body")
    assert_equal "Md Author · Run bin/rails db:migrate first.", payloads.last.fetch("body")
    assert_includes notification.body, "**What `git init` does:**", "the stored body keeps Markdown for in-app rendering"
  end

  test "grading feedback pushes show plain text instead of Markdown" do
    notification = Struct.new(:user_id, :title, :body, :legacy_path, :destination_path, :destination)
      .new(7, "Feedback on Loops", "**Close!** Use `for word in words:`\n\n```python\nprint(word)\n```", "/lessons/3", "/lessons/3")
    notification.define_singleton_method(:destination) { |resolved_path| RecordDestination.from_path(resolved_path) }
    payloads = []
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver_to_user) { |_user_id, raw_payload| payloads << JSON.parse(raw_payload) }

    service.submission_changed(Struct.new(:id).new(11), [ notification ])

    assert_equal "Close! Use for word in words: print(word)", payloads.sole.fetch("body")
    assert_equal "submission-11", payloads.sole.fetch("tag")
  end

  test "does not deliver to a user who disabled browser push" do
    user = User.create!(clerk_id: "web_push_disabled", email: "web-push-disabled@example.com", web_push_notifications_enabled: false)
    subscription = user.push_subscriptions.create!(endpoint: "https://push.example/disabled", p256dh: "public-key", auth: "auth-secret")
    deliveries = []
    service = WebPushNotificationService.new
    service.define_singleton_method(:deliver) { |item, _payload| deliveries << item.id }

    service.send(:deliver_to_user, user.id, "{}")

    assert_empty deliveries
    assert_nil subscription.reload.failed_at
  end

  test "each push request gets explicit timeouts instead of Net::HTTP's 60-second defaults" do
    received = []
    with_web_push(->(**kwargs) { received << kwargs }) do
      subscription = subscribed_user("timeouts").push_subscriptions.first
      WebPushNotificationService.new.batched { |service| service.send(:deliver_to_user, subscription.user_id, "{}") }
    end

    assert_equal 1, received.size
    assert_equal WebPushNotificationService::REQUEST_TIMEOUTS, received.first.slice(:open_timeout, :ssl_timeout, :read_timeout)
  end

  test "a stalled endpoint is cut off at the batch deadline and the others are still sent" do
    users = %w[stall-a stall-b stall-c].map { |name| subscribed_user(name) }
    stalled = users.first.push_subscriptions.first
    sent = Queue.new
    send_push = lambda do |endpoint:, **|
      # A response trickling in forever: Net::HTTP's read_timeout never fires.
      sleep 30 if endpoint == stalled.endpoint
      sent << endpoint
    end

    elapsed = with_batch_deadline(0.3) do
      with_web_push(send_push) do
        measure { WebPushNotificationService.new.batched { |service| users.each { |user| service.send(:deliver_to_user, user.id, "{}") } } }
      end
    end

    assert_operator elapsed, :<, 0.3 + WebPushNotificationService::WORKER_GRACE
    assert_equal users.drop(1).flat_map { |user| user.push_subscriptions.map(&:endpoint) }.sort, Array.new(sent.size) { sent.pop }.sort
    assert PushSubscription.exists?(stalled.id), "an unfinished send must not delete the subscription"
    assert_nil stalled.reload.failed_at, "an unfinished send keeps the subscription active for the next push"
    assert_empty live_delivery_threads
  end

  test "a worker that ignores the deadline is killed after the grace period" do
    user = subscribed_user("stubborn")
    subscription = user.push_subscriptions.first
    stubborn = lambda do |**|
      loop do
        sleep 30
      rescue Exception # rubocop:disable Lint/RescueException
        nil
      end
    end
    logs = StringIO.new
    original_logger = Rails.logger
    Rails.logger = ActiveSupport::Logger.new(logs)

    elapsed = with_batch_deadline(0.2, grace: 0.2) do
      with_web_push(stubborn) do
        measure { WebPushNotificationService.new.batched { |service| service.send(:deliver_to_user, user.id, "{}") } }
      end
    end

    assert_operator elapsed, :<, 1.5
    assert_empty live_delivery_threads
    assert_nil subscription.reload.failed_at
    assert_includes logs.string, "batch_deadline_exceeded unfinished=1 total=1"
    assert_includes logs.string, "not delivered to subscription #{subscription.id}: batch deadline exceeded"
  ensure
    Rails.logger = original_logger if original_logger
  end

  private

  def subscribed_user(name)
    user = User.create!(clerk_id: "web_push_#{name}", email: "web-push-#{name}@example.com", web_push_notifications_enabled: true)
    user.push_subscriptions.create!(endpoint: "https://push.example/#{name}", p256dh: "public-key", auth: "auth-secret")
    user
  end

  WEB_PUSH_ENV = { "WEB_PUSH_PUBLIC_KEY" => "public", "WEB_PUSH_PRIVATE_KEY" => "private", "WEB_PUSH_SUBJECT" => "mailto:push@example.com" }.freeze

  def with_web_push(send_push)
    original = WebPush.method(:payload_send)
    WebPush.define_singleton_method(:payload_send) { |**kwargs| send_push.call(**kwargs) }
    WEB_PUSH_ENV.each { |key, value| ENV[key] = value }
    yield
  ensure
    WEB_PUSH_ENV.each_key { |key| ENV.delete(key) }
    WebPush.define_singleton_method(:payload_send, original) if original
  end

  def with_batch_deadline(seconds, grace: WebPushNotificationService::WORKER_GRACE)
    originals = { BATCH_DEADLINE: WebPushNotificationService::BATCH_DEADLINE, WORKER_GRACE: WebPushNotificationService::WORKER_GRACE }
    replace_constants(BATCH_DEADLINE: seconds, WORKER_GRACE: grace)
    yield
  ensure
    replace_constants(**originals) if originals
  end

  def replace_constants(**values)
    values.each do |name, value|
      WebPushNotificationService.send(:remove_const, name)
      WebPushNotificationService.const_set(name, value)
    end
  end

  def measure
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    yield
    Process.clock_gettime(Process::CLOCK_MONOTONIC) - started
  end

  # A killed thread finishes its ensure blocks as soon as it is scheduled.
  def live_delivery_threads
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 1
    loop do
      threads = Thread.list.select { |thread| thread.name == "web-push-delivery" && thread.alive? }
      return threads if threads.empty? || Process.clock_gettime(Process::CLOCK_MONOTONIC) > deadline

      Thread.pass
    end
  end
end
