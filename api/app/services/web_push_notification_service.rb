require "json"
require "web-push"

class WebPushNotificationService
  # Push services answer each send separately, so a school-wide announcement is
  # one HTTP request per subscription. Production runs jobs inline in the
  # request, so the sends go out a few at a time instead of one after another,
  # and the whole batch has a deadline. Only the HTTP calls run on worker
  # threads; every database read and write stays on the calling thread and its
  # connection.
  MAX_CONCURRENT_DELIVERIES = 8
  # Passed to Net::HTTP for every push service request, replacing its 60-second
  # defaults. The library has no write timeout option; a payload is at most
  # 4 KB, and the batch deadline bounds that phase like every other.
  REQUEST_TIMEOUTS = { open_timeout: 5, ssl_timeout: 5, read_timeout: 5 }.freeze
  # A whole batch finishes within this many seconds. read_timeout applies to
  # each read, so an endpoint that trickles its response could otherwise hold
  # the request, and its Puma thread, indefinitely.
  BATCH_DEADLINE = 10
  # How long past the deadline to wait for a worker before killing it.
  WORKER_GRACE = 1

  def self.configured?
    ENV["WEB_PUSH_PUBLIC_KEY"].present? &&
      ENV["WEB_PUSH_PRIVATE_KEY"].present? &&
      ENV["WEB_PUSH_SUBJECT"].present?
  end

  def self.announcement_published(announcement, notifications)
    return false unless configured?

    new.batched { |service| service.announcement_published(announcement, notifications) }
  end

  def self.message_created(message, notifications)
    return false unless configured?

    new.batched { |service| service.message_created(message, notifications) }
  end

  def self.submission_changed(submission, notifications)
    return false unless configured?

    new.batched { |service| service.submission_changed(submission, notifications) }
  end

  def self.help_request_changed(help_request, notifications)
    return false unless configured?

    new.batched { |service| service.help_request_changed(help_request, notifications) }
  end

  def self.intervention_changed(intervention, notifications)
    return false unless configured?

    new.batched { |service| service.intervention_changed(intervention, notifications) }
  end

  def announcement_published(announcement, notifications)
    payload = {
      title: announcement.title,
      body: "#{announcement.author&.full_name || SchoolBrand.current.name} · #{MarkdownExcerpt.call(announcement.body, max_length: 150)}".truncate(180),
      path: "/announcements/#{announcement.id}",
      destination: RecordDestination.build(kind: "announcement", id: announcement.id),
      destination_path: "/announcements/#{announcement.id}",
      tag: "announcement-#{announcement.id}"
    }.to_json

    deliver_to_notifications(notifications, payload)
  end

  def message_created(message, notifications)
    each_notification(notifications) do |notification|
      destination_path = notification.destination_path
      payload = {
        title: notification.title,
        # Notification bodies keep the message's Markdown; the browser alert gets plain text.
        body: MarkdownExcerpt.call(notification.body),
        path: notification.legacy_path,
        destination: notification.destination(destination_path),
        destination_path: destination_path,
        message_id: message.id,
        tag: message.direct_message? ? "dm-#{message.direct_conversation_id}" : "channel-#{message.channel_id}"
      }.to_json

      deliver_to_user(notification.user_id, payload)
    end
  end

  def submission_changed(submission, notifications)
    each_notification(notifications) do |notification|
      destination_path = notification.destination_path
      payload = {
        title: notification.title,
        # The body can be grading feedback in Markdown; the browser alert gets plain text.
        body: MarkdownExcerpt.call(notification.body),
        path: notification.legacy_path,
        destination: notification.destination(destination_path),
        destination_path: destination_path,
        tag: "submission-#{submission.id}"
      }.to_json

      deliver_to_user(notification.user_id, payload)
    end
  end

  def help_request_changed(help_request, notifications)
    each_notification(notifications) do |notification|
      destination_path = notification.destination_path
      payload = {
        title: notification.title,
        body: notification.body,
        path: notification.legacy_path,
        destination: notification.destination(destination_path),
        destination_path: destination_path,
        tag: "help-request-#{help_request.id}"
      }.to_json

      deliver_to_user(notification.user_id, payload)
    end
  end

  def intervention_changed(intervention, notifications)
    each_notification(notifications) do |notification|
      destination_path = notification.destination_path
      payload = {
        title: notification.title,
        body: notification.body,
        path: notification.legacy_path,
        destination: notification.destination(destination_path),
        destination_path: destination_path,
        tag: "intervention-#{intervention.id}"
      }.to_json
      deliver_to_user(notification.user_id, payload)
    end
  end

  # Queues every send the block requests, then sends them together.
  def batched
    @queued_deliveries = []
    result = yield self
    send_queued(@queued_deliveries)
    result
  ensure
    @queued_deliveries = nil
  end

  private

  def deliver_to_notifications(notifications, payload)
    delivered_user_ids = {}

    each_notification(notifications) do |notification|
      next if delivered_user_ids[notification.user_id]

      delivered_user_ids[notification.user_id] = true
      deliver_to_user(notification.user_id, payload)
    end
  end

  def each_notification(notifications)
    if notifications.is_a?(ActiveRecord::Relation)
      notifications.find_each { |notification| yield notification }
    else
      Array(notifications).each { |notification| yield notification }
    end
  end

  def deliver_to_user(user_id, payload)
    PushSubscription.active.joins(:user).where(user_id: user_id, users: { web_push_notifications_enabled: true }).find_each do |subscription|
      deliver(subscription, payload)
    end
  end

  def deliver(subscription, payload)
    request = { message: payload, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth }
    return @queued_deliveries << [ subscription, request ] if @queued_deliveries

    send_queued([ [ subscription, request ] ])
  end

  def send_queued(deliveries)
    return if deliveries.empty?

    outcomes = send_within_deadline(deliveries.map(&:last))
    unfinished = outcomes.count(:deadline_exceeded)
    if unfinished.positive?
      Rails.logger.warn("[WebPush] batch_deadline_exceeded unfinished=#{unfinished} total=#{deliveries.size} deadline=#{BATCH_DEADLINE}s")
    end
    deliveries.zip(outcomes).each { |(subscription, _request), outcome| record_outcome(subscription, outcome) }
  end

  # Sends on up to MAX_CONCURRENT_DELIVERIES worker threads and returns one
  # outcome per request, in order, within BATCH_DEADLINE plus WORKER_GRACE.
  # Workers report through a queue that is closed before it is read, so a
  # worker still running after that cannot change an outcome; one that outlives
  # the grace period is killed, and its ensure blocks close its socket.
  def send_within_deadline(requests)
    deadline = monotonic_now + BATCH_DEADLINE
    pending = Thread::Queue.new
    requests.each_index { |index| pending << index }
    pending.close
    results = Thread::Queue.new

    workers = Array.new([ MAX_CONCURRENT_DELIVERIES, requests.size ].min) do
      Thread.new do
        Thread.current.name = "web-push-delivery"
        Thread.current.report_on_exception = false
        while (index = pending.pop)
          remaining = deadline - monotonic_now
          break if remaining <= 0

          results << [ index, send_request(requests[index], remaining) ]
        end
      rescue ClosedQueueError
        nil
      end
    end

    workers.each do |worker|
      next if worker.join([ deadline - monotonic_now, 0 ].max + WORKER_GRACE)

      worker.kill
    end
    results.close

    outcomes = Array.new(requests.size, :deadline_exceeded)
    while (result = results.pop)
      outcomes[result.first] = result.last
    end
    outcomes
  end

  # Runs on worker threads: HTTP only, no Active Record. Returns :sent, :gone,
  # :deadline_exceeded, or the error so the calling thread can update the
  # subscription.
  def send_request(request, time_limit)
    Timeout.timeout(time_limit) do
      WebPush.payload_send(
        **request,
        **REQUEST_TIMEOUTS,
        vapid: {
          subject: ENV.fetch("WEB_PUSH_SUBJECT"),
          public_key: ENV.fetch("WEB_PUSH_PUBLIC_KEY"),
          private_key: ENV.fetch("WEB_PUSH_PRIVATE_KEY")
        }
      )
    end
    :sent
  rescue WebPush::ExpiredSubscription, WebPush::InvalidSubscription
    :gone
  rescue => e
    # Timeout.timeout raises exactly Timeout::Error; Net::HTTP's own timeouts
    # are subclasses and count as failed requests.
    e.instance_of?(Timeout::Error) ? :deadline_exceeded : e
  end

  def monotonic_now
    Process.clock_gettime(Process::CLOCK_MONOTONIC)
  end

  def record_outcome(subscription, outcome)
    case outcome
    when :sent
      nil
    when :gone
      subscription.destroy
    when :deadline_exceeded
      # Not delivered, but the subscription did nothing wrong that we know of:
      # it may only have been queued behind a slow endpoint. Keep it active.
      Rails.logger.warn("[WebPush] not delivered to subscription #{subscription.id}: batch deadline exceeded")
    else
      Rails.logger.warn("[WebPush] failed for subscription #{subscription.id}: #{outcome.class} #{outcome.message}")
      subscription.mark_failed!
    end
  end
end
