class User < ApplicationRecord
  enum :role, { student: 0, instructor: 1, admin: 2 }

  scope :not_archived, -> { where(archived_at: nil) }
  scope :archived, -> { where.not(archived_at: nil) }

  has_many :enrollments, dependent: :destroy
  has_many :cohorts, through: :enrollments
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

  def archived?
    archived_at.present?
  end

  def invite_pending?
    clerk_id&.start_with?("pending_") || false
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
      knowledge_check_attempts.none?
  end

  def full_name
    [ first_name, last_name ].compact.join(" ").presence || email.split("@").first
  end

  def staff?
    admin? || instructor?
  end

  def community_terms_accepted?
    CommunityPolicy.accepted?(self)
  end

  def blocks?(user)
    user.present? && blocked_user_id_set.include?(user.id)
  end

  def blocked_by?(user)
    user.present? && blocks_received.exists?(blocker_id: user.id)
  end

  def blocked_relationship_with?(user)
    user.present? && blocked_relationship_user_ids.include?(user.id)
  end

  private

  def blocked_user_id_set
    @blocked_user_id_set ||= user_blocks.pluck(:blocked_user_id)
  end

  def blocked_relationship_user_ids
    @blocked_relationship_user_ids ||= blocked_user_id_set | blocks_received.pluck(:blocker_id)
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
