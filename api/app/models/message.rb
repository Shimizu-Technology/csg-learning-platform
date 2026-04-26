class Message < ApplicationRecord
  PINNED_LIMIT = 25

  belongs_to :channel, optional: true
  belongs_to :direct_conversation, optional: true
  belongs_to :author, class_name: "User"
  belongs_to :pinned_by, class_name: "User", optional: true
  belongs_to :parent_message, class_name: "Message", optional: true
  has_many :replies, class_name: "Message", foreign_key: :parent_message_id, dependent: :nullify
  has_many :notifications, as: :notifiable, dependent: :destroy
  has_many :channel_read_states, foreign_key: :last_read_message_id, dependent: :nullify
  has_many :message_attachments, dependent: :destroy
  has_many :message_reactions, dependent: :destroy

  validates :body, length: { maximum: 5000 }, allow_blank: true
  validate :exactly_one_destination
  validate :parent_message_belongs_to_same_channel
  validate :mention_user_ids_shape

  scope :visible, -> { where(deleted_at: nil) }
  scope :recent, -> { order(created_at: :desc) }
  scope :chronological, -> { order(:created_at, :id) }
  scope :pinned_recent, lambda {
    visible
      .where.not(pinned_at: nil)
      .includes(:author, :message_attachments, message_reactions: :user)
      .order(pinned_at: :desc, created_at: :desc, id: :desc)
      .limit(PINNED_LIMIT)
  }

  def deleted?
    deleted_at.present?
  end

  def editable_by?(user)
    return false unless user

    author_id == user.id || user.staff?
  end

  def destination
    channel || direct_conversation
  end

  def direct_message?
    direct_conversation_id.present?
  end

  def pinned?
    pinned_at.present?
  end

  private

  def mention_user_ids_shape
    ids = mention_user_ids
    unless ids.is_a?(Array) && ids.all? { |value| value.is_a?(Integer) || value.to_s.match?(/\A\d+\z/) }
      errors.add(:mention_user_ids, "must be an array of user ids")
      return
    end

    self.mention_user_ids = ids.map(&:to_i).uniq
  end

  def exactly_one_destination
    return if channel_id.present? ^ direct_conversation_id.present?

    errors.add(:base, "must belong to one channel or direct conversation")
  end

  def parent_message_belongs_to_same_channel
    return if parent_message_id.blank?
    return if parent_message&.channel_id == channel_id && parent_message&.direct_conversation_id == direct_conversation_id

    errors.add(:parent_message, "must belong to the same conversation")
  end
end
