require "json"
require "web-push"

class WebPushNotificationService
  # Push services answer each send separately, so a school-wide announcement is
  # one HTTP request per subscription. Production runs jobs inline in the
  # request, so the sends go out a few at a time instead of one after another.
  # Only the HTTP calls run on worker threads; every database read and write
  # stays on the calling thread and its connection.
  MAX_CONCURRENT_DELIVERIES = 8

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

    record_outcome(subscription, send_request(request))
  end

  def send_queued(deliveries)
    return if deliveries.empty?

    requests = deliveries.map(&:last)
    outcomes = requests.one? ? [ send_request(requests.first) ] : send_concurrently(requests)
    deliveries.zip(outcomes).each { |(subscription, _request), outcome| record_outcome(subscription, outcome) }
  end

  def send_concurrently(requests)
    outcomes = Array.new(requests.size)
    pending = Thread::Queue.new
    requests.each_index { |index| pending << index }
    pending.close

    Array.new([ MAX_CONCURRENT_DELIVERIES, requests.size ].min) do
      Thread.new do
        while (index = pending.pop)
          outcomes[index] = send_request(requests[index])
        end
      end
    end.each(&:join)
    outcomes
  end

  # Runs on worker threads: HTTP only, no Active Record. Returns :sent, :gone,
  # or the error so the calling thread can update the subscription.
  def send_request(request)
    WebPush.payload_send(
      **request,
      vapid: {
        subject: ENV.fetch("WEB_PUSH_SUBJECT"),
        public_key: ENV.fetch("WEB_PUSH_PUBLIC_KEY"),
        private_key: ENV.fetch("WEB_PUSH_PRIVATE_KEY")
      }
    )
    :sent
  rescue WebPush::ExpiredSubscription, WebPush::InvalidSubscription
    :gone
  rescue => e
    e
  end

  def record_outcome(subscription, outcome)
    case outcome
    when :sent
      nil
    when :gone
      subscription.destroy
    else
      Rails.logger.warn("[WebPush] failed for subscription #{subscription.id}: #{outcome.class} #{outcome.message}")
      subscription.mark_failed!
    end
  end
end
