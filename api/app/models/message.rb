class Message < ApplicationRecord
  belongs_to :channel
  belongs_to :author, class_name: "User"
  belongs_to :parent_message, class_name: "Message", optional: true
  has_many :replies, class_name: "Message", foreign_key: :parent_message_id, dependent: :nullify
  has_many :notifications, as: :notifiable, dependent: :destroy
  has_many :channel_read_states, foreign_key: :last_read_message_id, dependent: :nullify

  validates :body, presence: true, length: { maximum: 5000 }
  validate :parent_message_belongs_to_same_channel

  scope :visible, -> { where(deleted_at: nil) }
  scope :recent, -> { order(created_at: :desc) }
  scope :chronological, -> { order(:created_at, :id) }

  def deleted?
    deleted_at.present?
  end

  def editable_by?(user)
    return false unless user

    author_id == user.id || user.staff?
  end

  private

  def parent_message_belongs_to_same_channel
    return if parent_message_id.blank? || parent_message&.channel_id == channel_id

    errors.add(:parent_message, "must belong to the same channel")
  end
end
