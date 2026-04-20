class NotificationDeliveryService
  def self.announcement_published(announcement, push: false)
    new.announcement_published(announcement, push: push)
  end

  def announcement_published(announcement, push: false)
    return [] unless announcement.published?

    notifications = announcement.recipients.find_each.filter_map do |user|
      Notification.find_or_create_by(notifiable: announcement, user: user) do |notification|
        notification.actor = announcement.author
        notification.notification_type = :announcement
        notification.title = announcement.title
        notification.body = announcement.body
        notification.path = "/announcements/#{announcement.id}"
      end
    end

    WebPushNotificationService.announcement_published(announcement, notifications) if push
    notifications
  end
end
