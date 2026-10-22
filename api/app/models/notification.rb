class Notification < ApplicationRecord
  enum :notification_type, {
    announcement: 0,
    message: 1,
    direct_message: 2,
    recording: 3,
    redo: 4,
    system: 5,
    submission: 6,
    help_request: 7,
    intervention: 8
  }

  belongs_to :user
  belongs_to :actor, class_name: "User", optional: true
  belongs_to :notifiable, polymorphic: true

  validates :notification_type, presence: true
  validates :title, presence: true
  validates :path, presence: true

  scope :recent, -> { order(created_at: :desc) }
  scope :unread, -> { where(read_at: nil) }
  scope :visible_to, ->(user) {
    visible_message_ids = Message.where(channel_id: Channel.visible_for(user).select(:id))
      .or(Message.where(direct_conversation_id: DirectConversation.visible_for(user).select(:id))).select(:id)
    scope = where.not(notifiable_type: "Message")
      .or(where(notifiable_type: "Message", notifiable_id: visible_message_ids))
    blocked_actor_ids = user.blocked_relationship_user_ids
    scope = blocked_actor_ids.empty? ? scope : scope.where.not(notification_type: %i[message direct_message], actor_id: blocked_actor_ids)
    owned_case_ids = if user.staff?
      Intervention.joins(:enrollment).where(owner_id: user.id, enrollments: { cohort_id: user.accessible_cohorts.select(:id) }).select(:id)
    else
      Intervention.none.select(:id)
    end
    scope.where.not(notifiable_type: "Intervention")
      .or(scope.where(notifiable_type: "Intervention", notifiable_id: owned_case_ids))
  }

  # Keep the wire path compatible with installed clients; exact context is additive.
  def legacy_path
    return path.split(/[?#]/, 2).first if path.match?(%r{\A/(?:lessons/\d+|recordings|(?:admin/)?meetings)(?:[?#]|$)})

    path
  end

  def destination_path
    return LearningDestination.submission(notifiable) if notifiable.is_a?(Submission) && !user.staff?
    return LearningDestination.help_request(notifiable) if notifiable.is_a?(HelpRequest) && !user.staff?
    if notifiable.is_a?(PrivateMeetingBookingEvent)
      booking = notifiable.private_meeting_booking
      return "#{legacy_path}?cohort_id=#{booking.cohort_id}&booking_id=#{booking.id}&week=#{booking.week_number}"
    end
    return "/announcements/#{notifiable_id}" if notification_type == "announcement"

    path
  end

  def read?
    read_at.present?
  end

  def mark_read!
    update!(read_at: Time.current) unless read?
  end
end
