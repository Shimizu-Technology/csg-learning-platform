require "json"
require "net/http"

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

  def deliver_notifications(notifications)
    notification_list = notifications.is_a?(ActiveRecord::Relation) ? notifications.includes(user: :mobile_push_tokens).to_a : Array(notifications)
    entries = notification_list.flat_map do |notification|
      notification.user.mobile_push_tokens.active.map do |token|
        [ token, yield(notification).merge(to: token.token) ]
      end
    end

    entries.each_slice(BATCH_SIZE) { |batch| deliver_batch(batch) }
    entries.any?
  end

  private

  def deliver_batch(entries)
    response = post(entries.map(&:last).to_json)
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
  rescue JSON::ParserError, SocketError, SystemCallError, Timeout::Error => e
    Rails.logger.warn("[ExpoPush] delivery failed: #{e.class} #{e.message}")
  end

  def post(body)
    connection = Net::HTTP.new(ENDPOINT.host, ENDPOINT.port)
    connection.use_ssl = true
    connection.open_timeout = OPEN_TIMEOUT
    connection.read_timeout = READ_TIMEOUT

    request = Net::HTTP::Post.new(ENDPOINT.request_uri, "Content-Type" => "application/json", "Accept" => "application/json")
    request.body = body
    connection.request(request)
  end
end
