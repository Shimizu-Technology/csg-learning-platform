class User < ApplicationRecord
  enum :role, { student: 0, instructor: 1, admin: 2 }

  has_many :enrollments, dependent: :destroy
  has_many :cohorts, through: :enrollments
  has_many :progresses, dependent: :destroy
  has_many :submissions, dependent: :destroy
  has_many :graded_submissions, class_name: "Submission", foreign_key: :graded_by_id, dependent: :nullify
  has_many :watch_progresses, dependent: :destroy
  has_many :uploaded_recordings, class_name: "Recording", foreign_key: :uploaded_by_id, dependent: :nullify
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

  def full_name
    [ first_name, last_name ].compact.join(" ").presence || email.split("@").first
  end

  def staff?
    admin? || instructor?
  end
end
