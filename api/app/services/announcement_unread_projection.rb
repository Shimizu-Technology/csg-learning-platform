# Delivered announcement unread state within an already-authorized audience scope.
# Sharing this relation keeps Today and Updates counts independent of page/read filters.
class AnnouncementUnreadProjection
  def initialize(user, announcements)
    @user = user
    @announcements = announcements
  end

  def notifications
    @user.notifications.announcement.where(notifiable_type: "Announcement", notifiable_id: @announcements.select(:id))
  end

  def unread_ids
    notifications.unread.select(:notifiable_id)
  end

  def count
    notifications.unread.count
  end
end
