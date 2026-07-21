require "json"
require "net/http"
require "openssl"

class ExpoPushNotificationService
  ENDPOINT = URI("https://exp.host/--/api/v2/push/send")
  BATCH_SIZE = 100
  OPEN_TIMEOUT = 3
  READ_TIMEOUT = 5

  def self.announcement_published(announcement, notifications)
    new.deliver_notifications(notifications) do |notification|
      {
        title: "New CSG announcement",
        body: announcement.title,
        data: { path: "/updates" },
        sound: "default",
        channelId: "messages"
      }
    end
  end

  def self.message_created(message, notifications)
    new.deliver_notifications(notifications) do |notification|
      {
        title: notification.title,
        body: notification.body,
        data: {
          path: message.direct_message? ? "/conversation/dm/#{message.direct_conversation_id}" : "/conversation/channel/#{message.channel_id}"
        },
        sound: "default",
        channelId: "messages"
      }
    end
  end

  def self.submission_changed(submission, notifications)
    new.deliver_notifications(notifications) do |notification|
      path = notification.user.staff? ? "/staff/submission/#{submission.id}" : "/lesson/#{submission.content_block.lesson_id}"
      {
        title: notification.title,
        body: notification.body,
        data: { path: path },
        sound: "default",
        channelId: "messages"
      }
    end
  end

  def deliver_notifications(notifications)
    notification_list = Array.wrap(notifications)
    ActiveRecord::Associations::Preloader.new(records: notification_list, associations: { user: :mobile_push_tokens }).call
    entries = notification_list.flat_map do |notification|
      notification.user.mobile_push_tokens.select { |token| token.failed_at.nil? }.map do |token|
        [ token, yield(notification).merge(to: token.token) ]
      end
    end

    return false if entries.empty?

    connection = build_connection
    connection.start do |http|
      entries.each_slice(BATCH_SIZE) { |batch| deliver_batch(batch, http) }
    end
    true
  rescue OpenSSL::SSL::SSLError, SocketError, SystemCallError, Timeout::Error => e
    Rails.logger.warn("[ExpoPush] delivery failed: #{e.class} #{e.message}")
    true
  end

  private

  def deliver_batch(entries, connection)
    response = post(entries.map(&:last).to_json, connection)
    unless response.is_a?(Net::HTTPSuccess)
      Rails.logger.warn("[ExpoPush] request failed with HTTP #{response.code}")
      return
    end

    receipts = Array(JSON.parse(response.body)["data"])
    entries.zip(receipts).each do |(token, _payload), receipt|
      if receipt&.dig("status") == "error" && receipt.dig("details", "error") == "DeviceNotRegistered"
        token.mark_failed!
      elsif receipt&.dig("status") == "ok"
        token.mark_seen!
      end
    end
  rescue JSON::ParserError => e
    Rails.logger.warn("[ExpoPush] delivery failed: #{e.class} #{e.message}")
  end

  def build_connection
    connection = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
    connection.use_ssl = true
    connection.open_timeout = OPEN_TIMEOUT
    connection.read_timeout = READ_TIMEOUT
    connection
  end

  def post(body, connection)
    request = Net::HTTP::Post.new(ENDPOINT.request_uri, "Content-Type" => "application/json", "Accept" => "application/json")
    request.body = body
    connection.request(request)
  end
end
