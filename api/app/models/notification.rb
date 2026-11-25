class Notification < ApplicationRecord
  include ProviderEmailProvenance

  enum :notification_type, {
    announcement: 0,
    message: 1,
    direct_message: 2,
    recording: 3,
    redo: 4,
    system: 5,
    submission: 6,
    help_request: 7,
    intervention: 8,
    # Admin alerts (L-3.5): new Safety items and course purchases.
    content_report: 9,
    data_deletion_request: 10,
    course_purchase: 11,
    # Review requests, reviews and comments on files in a student's folder.
    cohort_file: 12
  }

  ADMIN_ONLY_TYPES = %w[content_report data_deletion_request course_purchase].freeze

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
    # An admin alert stays with the role: someone who is no longer an admin stops seeing it.
    scope = scope.where.not(notification_type: ADMIN_ONLY_TYPES) unless user.admin?
    # A file notice stays with access to the file: staff of its cohort, or the
    # student whose student-visible folder item it is, while still enrolled,
    # and for a paused student only events from before the pause.
    scope = if user.staff?
      scope.where.not(notifiable_type: "CohortFile")
        .or(scope.where(notifiable_type: "CohortFile", notifiable_id: CohortFile.where(cohort_id: user.accessible_cohorts.select(:id)).select(:id)))
    else
      readable_file = CohortFile.student_visible.where(student_id: [ nil, user.id ]).where("cohort_files.id = notifications.notifiable_id")
        .where(Enrollment.with_read_access.where(user_id: user.id).where("enrollments.cohort_id = cohort_files.cohort_id")
          .where("enrollments.status <> ? OR COALESCE(enrollments.paused_at, enrollments.read_cutoff_at) >= notifications.updated_at",
            Enrollment.statuses.fetch("paused")).arel.exists)
      scope.where.not(notifiable_type: "CohortFile").or(scope.where(notifiable_type: "CohortFile").where(readable_file.arel.exists))
    end
    scope.where.not(notifiable_type: "Intervention")
      .or(scope.where(notifiable_type: "Intervention", notifiable_id: owned_case_ids))
  }

  # Keep the wire path compatible with installed clients; exact context is additive.
  def legacy_path
    # Installed mobile builds route help requests only by the bare path.
    return path.split(/[?#]/, 2).first if path.match?(%r{\A/(?:lessons/\d+|recordings|(?:admin/)?meetings|admin/help-requests/\d+)(?:[?#]|$)})

    path
  end

  def destination_path
    return LearningDestination.submission(notifiable) if notifiable.is_a?(Submission) && !user.staff?
    return LearningDestination.help_request(notifiable, open: true) if notifiable.is_a?(HelpRequest) && !user.staff?
    # Older staff rows stored the bare request path; every row opens it with its cohort and student.
    return NotificationDeliveryService.staff_help_request_path(notifiable) if notifiable.is_a?(HelpRequest)
    if notifiable.is_a?(PrivateMeetingBookingEvent)
      booking = notifiable.private_meeting_booking
      return "#{legacy_path}?cohort_id=#{booking.cohort_id}&booking_id=#{booking.id}&week=#{booking.week_number}"
    end
    # The update's cohort travels with it, so the page doesn't fall back to the last cohort viewed (L-1.10).
    if notification_type == "announcement"
      cohort_id = notifiable.try(:cohort_id)
      return cohort_id ? "/announcements/#{notifiable_id}?cohort_id=#{cohort_id}" : "/announcements/#{notifiable_id}"
    end

    path
  end

  def destination(resolved_path = destination_path)
    # A file notice's path names the item to open (`file`, and `student` for
    # staff), which no record descriptor carries; clients follow the path.
    return nil if notifiable_type == "CohortFile"

    if notifiable.is_a?(Recording)
      return RecordDestination.build(kind: "recording", id: notifiable.id, context: { cohort_id: notifiable.cohort_id })
    end
    descriptor = RecordDestination.from_path(resolved_path)
    if descriptor && notifiable_type == "Message"
      descriptor[:anchor]["message_id"] = notifiable_id
    end
    descriptor
  end

  def read?
    read_at.present?
  end

  def mark_read!
    update!(read_at: Time.current) unless read?
  end
end
