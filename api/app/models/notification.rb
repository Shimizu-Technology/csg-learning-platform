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
    blocked_actor_ids = user.blocked_relationship_user_ids
    blocked_actor_ids.empty? ? all : where.not(notification_type: %i[message direct_message], actor_id: blocked_actor_ids)
  }

  def read?
    read_at.present?
  end

  def mark_read!
    update!(read_at: Time.current) unless read?
  end
end
