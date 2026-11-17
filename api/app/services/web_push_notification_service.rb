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
  # How long past the deadline to wait for workers before killing them.
  WORKER_GRACE = 0.5
  # How long killed workers get, together, to run their ensure blocks. The
  # batch takes at most BATCH_DEADLINE + WORKER_GRACE + KILL_GRACE (11 s).
  KILL_GRACE = 0.5

  def self.configured?
    ENV["WEB_PUSH_PUBLIC_KEY"].present? &&
      ENV["WEB_PUSH_PRIVATE_KEY"].present? &&
      ENV["WEB_PUSH_SUBJECT"].present?
  end

  def self.system_notice(record, notifications)
    return false unless configured?

    new.batched { |service| service.system_notice(record, notifications) }
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

  # The scheduled sweep loads every recipient's subscriptions once, then uses
  # the existing bounded HTTP batch for all follow-ups.
  def self.intervention_follow_ups(notifications)
    return false unless configured?

    new.batched { |service| service.intervention_follow_ups(notifications) }
  end

  def self.admin_alert(record, notifications)
    return false unless configured?

    new.batched { |service| service.admin_alert(record, notifications) }
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

  def intervention_follow_ups(notifications)
    deliver_path_notifications(notifications) { |notification| "intervention-#{notification.notifiable_id}" }
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

  def system_notice(record, notifications)
    deliver_path_notifications(notifications) { |_notification| "#{record.class.name.underscore.dasherize}-#{record.id}" }
  end

  def admin_alert(record, notifications)
    each_notification(notifications) do |notification|
      destination_path = notification.destination_path
      payload = {
        title: notification.title,
        body: notification.body.to_s,
        path: notification.legacy_path,
        destination: notification.destination(destination_path),
        destination_path: destination_path,
        tag: "#{record.class.name.underscore.dasherize}-#{record.id}"
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

  def deliver_path_notifications(notifications)
    items = notifications.to_a
    subscriptions = PushSubscription.active.joins(:user)
      .where(user_id: items.map(&:user_id), users: { web_push_notifications_enabled: true }).to_a.group_by(&:user_id)
    each_notification(items) do |notification|
      payload = { title: notification.title, body: notification.body, path: notification.path,
        destination: RecordDestination.from_path(notification.path), destination_path: notification.path,
        tag: yield(notification) }.to_json
      subscriptions.fetch(notification.user_id, []).each { |subscription| deliver(subscription, payload) }
    end
  end

  def deliver_to_notifications(notifications, payload)
    delivered_user_ids = {}

    each_notification(notifications) do |notification|
      next if delivered_user_ids[notification.user_id]

      delivered_user_ids[notification.user_id] = true
      deliver_to_user(notification.user_id, payload)
    end
  end

  # Each send queued while a notification is yielded is tagged with its id, so
  # a deadline can report which notifications were never started.
  def each_notification(notifications)
    if notifications.is_a?(ActiveRecord::Relation)
      notifications.find_each { |notification| with_current_notification(notification) { yield notification } }
    else
      Array(notifications).each { |notification| with_current_notification(notification) { yield notification } }
    end
  end

  def with_current_notification(notification)
    @current_notification_id = notification.id if notification.respond_to?(:id)
    yield
  ensure
    @current_notification_id = nil
  end

  def deliver_to_user(user_id, payload)
    PushSubscription.active.joins(:user).where(user_id: user_id, users: { web_push_notifications_enabled: true }).find_each do |subscription|
      deliver(subscription, payload)
    end
  end

  def deliver(subscription, payload)
    request = { message: payload, endpoint: subscription.endpoint, p256dh: subscription.p256dh, auth: subscription.auth }
    delivery = [ subscription, request, @current_notification_id ]
    return @queued_deliveries << delivery if @queued_deliveries

    send_queued([ delivery ])
  end

  # Records every outcome first, then raises PushDeliveryNotStarted for the
  # notifications none of whose requests started before the deadline, so the
  # caller can release them for a retry. A notification with any request that
  # started is never listed: that request may have reached the device.
  def send_queued(deliveries)
    return if deliveries.empty?

    outcomes = send_within_deadline(deliveries.map { |delivery| delivery[1] })
    not_started = outcomes.count(:not_started)
    uncertain = outcomes.count(:deadline_exceeded)
    if (not_started + uncertain).positive?
      Rails.logger.warn(
        "[WebPush] batch_deadline_exceeded not_started=#{not_started} unfinished=#{uncertain} " \
        "total=#{deliveries.size} deadline=#{BATCH_DEADLINE}s"
      )
    end
    deliveries.zip(outcomes).each { |(subscription, _request, _notification_id), outcome| record_outcome(subscription, outcome) }

    retryable_ids = deliveries.zip(outcomes)
      .group_by { |(_subscription, _request, notification_id), _outcome| notification_id }
      .filter_map { |notification_id, pairs| notification_id if notification_id && pairs.all? { |_delivery, outcome| outcome == :not_started } }
    raise PushDeliveryNotStarted.new(provider: "web_push", notification_ids: retryable_ids) if retryable_ids.any?
  end

  # Sends on up to MAX_CONCURRENT_DELIVERIES worker threads and returns one
  # outcome per request, in order. The whole call takes at most
  # BATCH_DEADLINE + WORKER_GRACE + KILL_GRACE, however many workers ignore
  # the deadline: workers still running WORKER_GRACE after the deadline are
  # killed together, and their cleanup gets one shared KILL_GRACE.
  #
  # A worker reports :started before it calls the provider, then the result.
  # The results queue is closed before it is read, so a worker still running
  # after that cannot change an outcome. A request no worker started stays
  # :not_started (never attempted: safe to retry); one that started without
  # reporting a result becomes :deadline_exceeded (uncertain: never retried).
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

          results << [ index, :started ]
          results << [ index, send_request(requests[index], remaining) ]
        end
      rescue ClosedQueueError
        nil
      end
    end

    stop_workers(workers, deadline)
    results.close

    outcomes = Array.new(requests.size, :not_started)
    while (result = results.pop)
      outcomes[result.first] = result.last
    end
    outcomes.map { |outcome| outcome == :started ? :deadline_exceeded : outcome }
  end

  # One absolute budget for the whole batch: wait for every worker until
  # WORKER_GRACE past the deadline, kill all that remain at once, then give
  # their ensure blocks (which close sockets) until KILL_GRACE after that. A
  # thread still alive then is abandoned rather than waited for.
  def stop_workers(workers, deadline)
    stop_at = deadline + WORKER_GRACE
    workers.each { |worker| worker.join([ stop_at - monotonic_now, 0 ].max) }
    stragglers = workers.select(&:alive?)
    return if stragglers.empty?

    stragglers.each(&:kill)
    cleanup_by = stop_at + KILL_GRACE
    stragglers.each { |worker| worker.join([ cleanup_by - monotonic_now, 0 ].max) }
    abandoned = stragglers.count(&:alive?)
    Rails.logger.warn("[WebPush] killed=#{stragglers.size} abandoned=#{abandoned} delivery threads after the batch deadline")
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
    when :not_started
      # Never sent: it was queued behind slow endpoints. Keep it active.
      Rails.logger.warn("[WebPush] not started for subscription #{subscription.id}: batch deadline exceeded")
    when :deadline_exceeded
      # Started but unfinished, so it may or may not have arrived. The
      # subscription did nothing wrong that we know of. Keep it active.
      Rails.logger.warn("[WebPush] not delivered to subscription #{subscription.id}: batch deadline exceeded")
    else
      Rails.logger.warn("[WebPush] failed for subscription #{subscription.id}: #{outcome.class} #{outcome.message}")
      subscription.mark_failed!
    end
  end
end
