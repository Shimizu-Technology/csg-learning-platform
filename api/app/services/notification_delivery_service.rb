class NotificationDeliveryService
  def self.announcement_published(announcement, push: false)
    new.announcement_published(announcement, push: push)
  end

  def self.message_created(message, push: false)
    new.message_created(message, push: push)
  end

  def announcement_published(announcement, push: false)
    return [] unless announcement.published?

    notifications = announcement.recipients.find_each.filter_map do |user|
      notification_for(user, announcement)
    end

    PushNotificationJob.perform_later("Announcement", announcement.id, notifications.map(&:id)) if push && notifications.any?
    notifications
  end

  def message_created(message, push: false)
    return [] if message.deleted?

    notifications = message.channel.recipients.find_each.filter_map do |user|
      next if user.id == message.author_id

      message_notification_for(user, message)
    end

    PushNotificationJob.perform_later("Message", message.id, notifications.map(&:id)) if push && notifications.any?
    notifications
  end

  private

  def notification_for(user, announcement)
    Notification.find_or_create_by!(notifiable: announcement, user: user) do |notification|
      notification.actor = announcement.author
      notification.notification_type = :announcement
      notification.title = announcement.title
      notification.body = announcement.body
      notification.path = "/announcements/#{announcement.id}"
    end
  rescue ActiveRecord::RecordNotUnique
    Notification.find_by!(notifiable: announcement, user: user)
  end

  def message_notification_for(user, message)
    Notification.find_or_create_by!(notifiable: message, user: user) do |notification|
      notification.actor = message.author
      notification.notification_type = :message
      notification.title = "#{message.channel.name} has a new message"
      notification.body = message.body.truncate(180)
      notification.path = "/messages/#{message.channel_id}"
    end
  rescue ActiveRecord::RecordNotUnique
    Notification.find_by!(notifiable: message, user: user)
  end
end
