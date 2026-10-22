class User < ApplicationRecord
  INVITE_DELIVERY_STATUSES = %w[not_sent queued sent failed accepted].freeze
  # Invitation links are Clerk invitations created with this lifetime
  # (ClerkInvitationService passes it as expires_in_days).
  INVITE_LINK_LIFETIME = 30.days

  enum :role, { student: 0, instructor: 1, admin: 2 }

  scope :not_archived, -> { where(archived_at: nil) }
  scope :archived, -> { where.not(archived_at: nil) }

  has_many :enrollments, dependent: :destroy
  has_many :course_purchases, dependent: :restrict_with_error
  has_many :cohorts, through: :enrollments
  has_many :cohort_instructor_assignments, dependent: :destroy
  has_many :assigned_cohorts, through: :cohort_instructor_assignments, source: :cohort
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy
  has_many :graded_submissions, class_name: "Submission", foreign_key: :graded_by_id, dependent: :nullify
  has_many :watch_progresses, dependent: :destroy
  has_many :uploaded_recordings, class_name: "Recording", foreign_key: :uploaded_by_id, dependent: :nullify
  has_many :uploaded_content_block_videos, class_name: "ContentBlock", foreign_key: :s3_video_uploaded_by_id, dependent: :nullify
  has_many :announcements, foreign_key: :author_id, dependent: :nullify
  has_many :notifications, dependent: :destroy
  has_many :acted_notifications, class_name: "Notification", foreign_key: :actor_id, dependent: :nullify
  has_many :push_subscriptions, dependent: :destroy
  has_many :mobile_push_tokens, dependent: :destroy
  has_many :clerk_identities, dependent: :destroy
  has_many :auth_sessions, dependent: :destroy
  has_many :activity_events, foreign_key: :subject_user_id, dependent: :destroy
  has_many :performed_activity_events, class_name: "ActivityEvent", foreign_key: :actor_id, dependent: :destroy
  has_many :messages, foreign_key: :author_id, dependent: :nullify
  has_many :channel_read_states, dependent: :destroy
  has_many :direct_conversation_members, dependent: :destroy
  has_many :direct_conversations, through: :direct_conversation_members
  has_many :workspace_memberships, dependent: :destroy
  has_many :workspaces, through: :workspace_memberships
  has_many :message_attachments, foreign_key: :uploaded_by_id, dependent: :restrict_with_exception
  has_many :message_reactions, dependent: :destroy
  has_many :message_preferences, dependent: :destroy
  has_many :user_blocks, foreign_key: :blocker_id, dependent: :destroy, inverse_of: :blocker
  has_many :blocked_users, through: :user_blocks, source: :blocked_user
  has_many :blocks_received, class_name: "UserBlock", foreign_key: :blocked_user_id, dependent: :destroy, inverse_of: :blocked_user
  has_many :content_reports, foreign_key: :reporter_id, dependent: :restrict_with_exception, inverse_of: :reporter
  has_many :reports_received, class_name: "ContentReport", foreign_key: :reported_user_id, dependent: :restrict_with_exception, inverse_of: :reported_user
  has_many :data_deletion_requests, dependent: :restrict_with_exception
  has_many :created_office_hours, class_name: "OfficeHour", foreign_key: :created_by_id, dependent: :nullify
  has_many :instructed_private_meeting_configs, class_name: "PrivateMeetingConfig", foreign_key: :instructor_id, dependent: :restrict_with_error
  has_many :student_private_meeting_bookings, class_name: "PrivateMeetingBooking", foreign_key: :student_id, dependent: :restrict_with_error
  has_many :instructor_private_meeting_bookings, class_name: "PrivateMeetingBooking", foreign_key: :instructor_id, dependent: :restrict_with_error
  has_many :created_submission_windows, class_name: "CohortModuleSubmissionWindow", foreign_key: :created_by_id, dependent: :nullify
  has_many :updated_submission_windows, class_name: "CohortModuleSubmissionWindow", foreign_key: :updated_by_id, dependent: :nullify
  has_many :help_requests, foreign_key: :student_id, dependent: :destroy
  has_many :owned_help_requests, class_name: "HelpRequest", foreign_key: :owner_id, dependent: :nullify
  has_many :feedback_snippets, foreign_key: :created_by_id, inverse_of: :created_by, dependent: :destroy
  has_many :knowledge_check_attempts, dependent: :destroy
  has_many :owned_interventions, class_name: "Intervention", foreign_key: :owner_id, dependent: :restrict_with_exception
  has_many :created_interventions, class_name: "Intervention", foreign_key: :created_by_id, dependent: :restrict_with_exception
  has_many :intervention_notes, foreign_key: :author_id, dependent: :restrict_with_exception
  has_many :owned_recovery_plans, class_name: "RecoveryPlan", foreign_key: :owner_id, dependent: :restrict_with_exception
  has_many :created_recovery_plans, class_name: "RecoveryPlan", foreign_key: :created_by_id, dependent: :restrict_with_exception
  has_many :recovery_plan_check_ins, foreign_key: :author_id, dependent: :restrict_with_exception

  validates :clerk_id, presence: true, uniqueness: true
  validates :email, presence: true, uniqueness: { case_sensitive: false }
  validates :role, presence: true
  validates :invite_delivery_status, inclusion: { in: INVITE_DELIVERY_STATUSES }

  # Serialize removals across different admin rows, not just changes to one user.
  # The transaction-scoped lock remains held until the update/destroy commits.
  before_update :preserve_accepted_admin
  before_destroy -> { preserve_accepted_admin(destroying: true) }, prepend: true

  scope :accepted_active_admins, -> { admin.not_archived.where("LEFT(clerk_id, 8) <> ?", "pending_") }

  def archived?
    archived_at.present?
  end

  def invite_pending?
    clerk_id&.start_with?("pending_") || false
  end

  # When the emailed invitation link stops working; nil unless one was sent and is still pending.
  def invite_expires_at
    return nil unless invite_pending? && invite_delivery_status == "sent" && invite_sent_at

    invite_sent_at + INVITE_LINK_LIFETIME
  end

  # One staff-facing invitation state derived from stored delivery data, with no
  # external calls: accepted, expired, sent, failed, queued or not_sent.
  def invite_state(now: Time.current)
    return "accepted" unless invite_pending?
    return "expired" if invite_expires_at && invite_expires_at <= now
    return "not_sent" if invite_delivery_status == "accepted"

    invite_delivery_status
  end

  def archive!
    transaction do
      update!(archived_at: Time.current)
      mobile_push_tokens.destroy_all
      push_subscriptions.destroy_all
      archive_or_detach_direct_conversations!
    end
  end

  def unarchive!
    update!(archived_at: nil)
  end

  def safe_to_hard_delete?
    invite_pending? &&
      enrollments.none? &&
      messages.none? &&
      announcements.none? &&
      submissions.none? &&
      progresses.none? &&
      watch_progresses.none? &&
      uploaded_recordings.none? &&
      uploaded_content_block_videos.none? &&
      message_attachments.none? &&
      direct_conversation_members.none? &&
      help_requests.none? &&
      feedback_snippets.none? &&
      knowledge_check_attempts.none? &&
      activity_events.none? &&
      performed_activity_events.none?
  end

  def full_name
    [ first_name, last_name ].compact.join(" ").presence || email.split("@").first
  end

  def staff?
    admin? || instructor?
  end

  def accessible_cohorts
    return Cohort.none if archived?
    return Cohort.all if admin?
    return assigned_cohorts if instructor?

    Cohort.where(id: enrollments.with_read_access.select(:cohort_id))
  end

  def can_access_cohort?(cohort)
    return false if cohort.nil? || archived?
    return true if admin?
    return cohort_instructor_assignments.exists?(cohort_id: cohort.id) if instructor?

    enrollments.with_read_access.exists?(cohort_id: cohort.id)
  end

  def can_teach_cohort?(cohort)
    staff? && can_access_cohort?(cohort)
  end

  def community_terms_accepted?
    CommunityPolicy.accepted?(self)
  end

  def blocked_relationship_with?(user)
    user.present? && blocked_relationship_user_ids.include?(user.id)
  end

  def blocked_relationship_user_ids
    @blocked_relationship_user_ids ||= user_blocks.pluck(:blocked_user_id) | blocks_received.pluck(:blocker_id)
  end

  private

  def preserve_accepted_admin(destroying: false)
    continuity_attributes = %w[role archived_at clerk_id]
    return unless destroying || continuity_attributes.any? { |attribute| will_save_change_to_attribute?(attribute) }

    # Loaded originals can predate a promotion or invite acceptance. Serialize first,
    # then read the persisted row without the query cache, preserving pending edits.
    self.class.connection.execute("SELECT pg_advisory_xact_lock(2026102201)")
    persisted = self.class.uncached { self.class.unscoped.lock.find_by(id: id) }
    return unless persisted&.admin? && !persisted.archived? && !persisted.invite_pending?

    resulting = persisted.attributes.slice(*continuity_attributes)
    continuity_attributes.each do |attribute|
      resulting[attribute] = self[attribute] if will_save_change_to_attribute?(attribute)
    end
    removing_admin = destroying || resulting["role"] != "admin" || resulting["archived_at"].present? || resulting["clerk_id"].to_s.start_with?("pending_")
    return unless removing_admin
    return if self.class.uncached { self.class.accepted_active_admins.where.not(id: id).exists? }

    errors.add(:base, "Cannot remove the last active admin who has accepted their invitation. Add another admin and have them sign in first.")
    throw :abort
  end

  def archive_or_detach_direct_conversations!
    direct_conversations.includes(:users, :workspace).find_each do |conversation|
      active_member_ids = conversation.users.reject { |user| user.archived_at.present? }.map(&:id)
      if active_member_ids.size <= 1
        conversation.update!(status: :archived)
      else
        active_member_key = DirectConversation.member_key_for(active_member_ids)
        existing_conversation = conversation.workspace.direct_conversations
          .where.not(id: conversation.id)
          .find_by(member_key: active_member_key)
        if existing_conversation
          conversation.update!(status: :archived)
          next
        end

        conversation.direct_conversation_members.where(user_id: id).destroy_all
        conversation.update!(member_key: active_member_key)
      end
    end
  end
end
