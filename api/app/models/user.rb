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
  has_many :messages, foreign_key: :author_id, dependent: :nullify
  has_many :channel_read_states, dependent: :destroy
  has_many :direct_conversation_members, dependent: :destroy
  has_many :direct_conversations, through: :direct_conversation_members
  has_many :workspace_memberships, dependent: :destroy
  has_many :workspaces, through: :workspace_memberships
  has_many :message_attachments, foreign_key: :uploaded_by_id, dependent: :restrict_with_exception
  has_many :message_reactions, dependent: :destroy
  has_many :message_preferences, dependent: :destroy

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
      direct_conversation_members.none?
  end

  def full_name
    [ first_name, last_name ].compact.join(" ").presence || email.split("@").first
  end

  def staff?
    admin? || instructor?
  end

  private

  def archive_or_detach_direct_conversations!
    direct_conversations.includes(:users).find_each do |conversation|
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
