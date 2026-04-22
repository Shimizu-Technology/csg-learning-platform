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
    each_notification(notifications) do |notification|
      payload = {
        title: notification.title,
        body: notification.body,
        path: notification.path,
        tag: message.direct_message? ? "dm-#{message.direct_conversation_id}" : "channel-#{message.channel_id}"
      }.to_json

      deliver_to_user(notification.user_id, payload)
    end
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
    PushSubscription.active.where(user_id: user_id).find_each do |subscription|
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
