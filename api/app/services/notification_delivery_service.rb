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

    destination = message.destination
    muted_user_ids = MessagePreference.where(target: destination, muted: true)
      .pluck(:user_id)
      .index_with(true)

    notifications = message.destination.recipients.find_each.filter_map do |user|
      next if user.id == message.author_id
      next if muted_user_ids.key?(user.id)

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
      notification.notification_type = message.direct_message? ? :direct_message : :message
      notification.title = message.direct_message? ? "#{message.author.full_name} sent you a message" : "#{message.channel.name} has a new message"
      notification.body = message_notification_body(message)
      notification.path = message.direct_message? ? "/messages/dm/#{message.direct_conversation_id}" : "/messages/#{message.channel_id}"
    end
  rescue ActiveRecord::RecordNotUnique
    Notification.find_by!(notifiable: message, user: user)
  end

  def message_notification_body(message)
    body = message.body.to_s.strip
    return body.truncate(180) if body.present?

    attachment_count = message.message_attachments.size
    return "Sent an attachment" if attachment_count == 1
    return "Sent #{attachment_count} attachments" if attachment_count > 1

    "Sent a message"
  end
end
