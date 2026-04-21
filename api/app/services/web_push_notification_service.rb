require "json"
require "web-push"

class WebPushNotificationService
  def self.configured?
    ENV["WEB_PUSH_PUBLIC_KEY"].present? &&
      ENV["WEB_PUSH_PRIVATE_KEY"].present? &&
      ENV["WEB_PUSH_SUBJECT"].present?
  end

  def self.announcement_published(announcement, notifications)
    return false unless configured?

    new.announcement_published(announcement, notifications)
  end

  def self.message_created(message, notifications)
    return false unless configured?

    new.message_created(message, notifications)
  end

  def announcement_published(announcement, notifications)
    payload = {
      title: "New CSG announcement",
      body: announcement.title,
      path: "/announcements/#{announcement.id}",
      tag: "announcement-#{announcement.id}"
    }.to_json

    deliver_to_notifications(notifications, payload)
  end

  def message_created(message, notifications)
    title = message.direct_message? ? message.author.full_name : message.channel.name
    path = message.direct_message? ? "/messages/dm/#{message.direct_conversation_id}" : "/messages/#{message.channel_id}"
    tag = message.direct_message? ? "dm-#{message.direct_conversation_id}" : "channel-#{message.channel_id}"
    payload = {
      title: title,
      body: "#{message.author.full_name}: #{message_notification_body(message)}",
      path: path,
      tag: tag
    }.to_json

    deliver_to_notifications(notifications, payload)
  end

  private

  def deliver_to_notifications(notifications, payload)
    user_ids = notifications.map(&:user_id).uniq
    PushSubscription.active.where(user_id: user_ids).find_each do |subscription|
      deliver(subscription, payload)
    end
  end

  def deliver(subscription, payload)
    WebPush.payload_send(
      message: payload,
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      vapid: {
        subject: ENV.fetch("WEB_PUSH_SUBJECT"),
        public_key: ENV.fetch("WEB_PUSH_PUBLIC_KEY"),
        private_key: ENV.fetch("WEB_PUSH_PRIVATE_KEY")
      }
    )
  rescue WebPush::ExpiredSubscription, WebPush::InvalidSubscription
    subscription.destroy
  rescue => e
    Rails.logger.warn("[WebPush] failed for subscription #{subscription.id}: #{e.class} #{e.message}")
    subscription.mark_failed!
  end

  def message_notification_body(message)
    body = message.body.to_s.strip
    return body.truncate(120) if body.present?

    attachment_count = message.message_attachments.size
    return "Sent an attachment" if attachment_count == 1
    return "Sent #{attachment_count} attachments" if attachment_count > 1

    "Sent a message"
  end
end
