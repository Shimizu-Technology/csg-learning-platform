require "json"
require "net/http"
require "openssl"

class ExpoPushNotificationService
  ENDPOINT = URI("https://exp.host/--/api/v2/push/send")
  BATCH_SIZE = 100
  OPEN_TIMEOUT = 3
  READ_TIMEOUT = 5
  WRITE_TIMEOUT = 5
  # Every batch for one notification finishes within this many seconds.
  # read_timeout applies to each read, so a response that trickles in could
  # otherwise hold the request, and its Puma thread, indefinitely.
  DELIVERY_DEADLINE = 10

  def self.announcement_published(announcement, notifications)
    new.deliver_notifications(notifications) do |notification|
      {
        title: announcement.title,
        body: "#{announcement.author&.full_name || SchoolBrand.current.name} · #{MarkdownExcerpt.call(announcement.body, max_length: 150)}".truncate(180),
        data: { destination: RecordDestination.build(kind: "announcement", id: announcement.id), path: "/updates", destination_path: "/updates?announcement_id=#{announcement.id}" },
        sound: "default",
        channelId: "announcements"
      }
    end
  end

  def self.message_created(message, notifications)
    new.deliver_notifications(notifications) do |notification|
      path = message.direct_message? ? "/conversation/dm/#{message.direct_conversation_id}" : "/conversation/channel/#{message.channel_id}"
      {
        title: notification.title,
        # Notification bodies keep the message's Markdown; the lock screen gets plain text.
        body: MarkdownExcerpt.call(notification.body),
        data: {
          destination: notification.destination,
          path: path,
          destination_path: "#{path}?messageId=#{message.id}",
          message_id: message.id
        },
        sound: "default",
        channelId: "messages"
      }
    end
  end

  def self.submission_changed(submission, notifications)
    new.deliver_notifications(notifications) do |notification|
      destination_path = notification.destination_path
      path = notification.user.staff? ? mobile_staff_submission_path(submission, notification) : "/lesson/#{submission.content_block.lesson_id}"
      {
        title: notification.title,
        body: MarkdownExcerpt.call(notification.body),
        data: { destination: notification.destination(destination_path), path: path, destination_path: notification.user.staff? ? path : mobile_learning_path(destination_path) },
        sound: "default",
        channelId: "learning"
      }
    end
  end

  def self.help_request_changed(help_request, notifications)
    new.deliver_notifications(notifications) do |notification|
      destination_path = notification.destination_path
      path = notification.user.staff? ? "/staff/support/#{help_request.id}" : mobile_help_path(help_request)
      {
        title: notification.title,
        body: notification.body,
        data: { destination: notification.destination(destination_path), path: path, destination_path: notification.user.staff? ? path : mobile_learning_path(destination_path) },
        sound: "default",
        channelId: "learning"
      }
    end
  end

  def self.intervention_changed(intervention, notifications)
    new.deliver_notifications(notifications) do |notification|
      {
        title: notification.title,
        body: notification.body,
        data: { destination: notification.destination, path: "/staff/intervention/#{intervention.id}", destination_path: "/staff/intervention/#{intervention.id}" },
        sound: "default",
        channelId: "learning"
      }
    end
  end

  def self.mobile_help_path(help_request)
    return "/lesson/#{help_request.context_path.delete_prefix('/lessons/').split(/[?#]/, 2).first}" if help_request.context_path.start_with?("/lessons/")

    "/recordings"
  end

  def self.mobile_learning_path(path)
    RecordDestination.to_native_href(RecordDestination.from_path(path)) || path
  end

  def self.mobile_staff_submission_path(submission, notification)
    web_prefix = "/admin/submissions/#{submission.id}"
    suffix = notification.path.delete_prefix(web_prefix)
    return "/staff/submission/#{submission.id}" unless notification.path.start_with?(web_prefix) && (suffix.empty? || suffix.start_with?("?"))

    "/staff/submission/#{submission.id}#{suffix}"
  end

  def deliver_notifications(notifications)
    notification_list = Array.wrap(notifications)
    ActiveRecord::Associations::Preloader.new(records: notification_list, associations: { user: :mobile_push_tokens }).call
    entries = notification_list.flat_map do |notification|
      next [] unless notification.user.mobile_push_notifications_enabled?

      notification.user.mobile_push_tokens.select { |token| token.failed_at.nil? }.map do |token|
        payload = yield(notification)
        payload = payload.merge(data: (payload[:data] || {}).merge(recipient_user_id: notification.user_id))
        [ token, payload.merge(to: token.token), notification.id ]
      end
    end

    if entries.empty?
      ExpoPushReceiptJob.drain_due_inline
      return false
    end

    batches = entries.each_slice(BATCH_SIZE).to_a
    not_started = deliver_batches(batches)
    ExpoPushReceiptJob.drain_due_inline
    raise_not_started(batches, not_started) if not_started.any?
    true
  rescue OpenSSL::SSL::SSLError, SocketError, SystemCallError, Timeout::Error => e
    Rails.logger.warn("[ExpoPush] delivery failed: #{e.class} #{e.message}")
    true
  end

  private

  # Sends the batches in order on one connection, all within
  # DELIVERY_DEADLINE, and returns the batches that were never started.
  #
  # A batch whose request started and then timed out (the deadline, or
  # Net::HTTP's own timeouts) is uncertain: Expo may have accepted it, so it
  # is logged and never retried. The batches after it, and any left when the
  # deadline passes between batches, were never sent. A failure to connect
  # at all still propagates to deliver_notifications' rescue, as before.
  def deliver_batches(batches)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + DELIVERY_DEADLINE
    not_started = []
    build_connection.start do |http|
      batches.each_with_index do |batch, index|
        remaining = deadline - Process.clock_gettime(Process::CLOCK_MONOTONIC)
        if remaining <= 0
          not_started = batches.drop(index)
          break
        end

        begin
          deliver_batch(batch, http, remaining)
        rescue Timeout::Error => e
          Rails.logger.warn("[ExpoPush] batch unfinished: #{e.class} #{e.message} tokens=#{batch.size}")
          not_started = batches.drop(index + 1)
          break
        end
      end
    end
    not_started
  end

  # Only notifications with no token in a started batch are listed: a token
  # in a started batch may already have been notified.
  def raise_not_started(batches, not_started)
    started_ids = (batches - not_started).flatten(1).map(&:last)
    not_started_ids = not_started.flatten(1).map(&:last)
    Rails.logger.warn("[ExpoPush] deadline_exceeded not_started_batches=#{not_started.size} total_batches=#{batches.size}")
    retryable_ids = (not_started_ids - started_ids).uniq
    raise PushDeliveryNotStarted.new(provider: "expo", notification_ids: retryable_ids) if retryable_ids.any?
  end

  # Only the HTTP call is inside the timeout: the token updates below run
  # after it.
  def deliver_batch(entries, connection, time_limit)
    body = entries.map { |entry| entry[1] }.to_json
    response = Timeout.timeout(time_limit) { post(body, connection) }
    unless response.is_a?(Net::HTTPSuccess)
      Rails.logger.warn("[ExpoPush] request failed with HTTP #{response.code}")
      return
    end

    receipts = Array(JSON.parse(response.body)["data"])
    receipt_requests = []
    entries.zip(receipts).each do |(token, _payload, _notification_id), receipt|
      if receipt&.dig("status") == "error" && receipt.dig("details", "error") == "DeviceNotRegistered"
        token.mark_failed!
      elsif receipt&.dig("status") == "ok"
        token.mark_seen!
        receipt_id = receipt["id"].to_s
        receipt_requests << { "receipt_id" => receipt_id, "mobile_push_token_id" => token.id } if receipt_id.present?
      end
    end
    ExpoPushReceiptJob.track(receipt_requests)
  rescue JSON::ParserError => e
    Rails.logger.warn("[ExpoPush] delivery failed: #{e.class} #{e.message}")
  end

  def build_connection
    connection = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
    connection.use_ssl = true
    connection.open_timeout = OPEN_TIMEOUT
    connection.read_timeout = READ_TIMEOUT
    connection.write_timeout = WRITE_TIMEOUT
    connection
  end

  def post(body, connection)
    request = Net::HTTP::Post.new(ENDPOINT.request_uri, "Content-Type" => "application/json", "Accept" => "application/json")
    request["Authorization"] = "Bearer #{ENV.fetch('EXPO_ACCESS_TOKEN')}" if ENV["EXPO_ACCESS_TOKEN"].present?
    request.body = body
    connection.request(request)
  end
end
