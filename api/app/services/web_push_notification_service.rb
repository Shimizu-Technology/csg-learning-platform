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
    payload = {
      title: message.channel.name,
      body: "#{message.author.full_name}: #{message.body.truncate(120)}",
      path: "/messages/#{message.channel_id}",
      tag: "channel-#{message.channel_id}"
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
end
