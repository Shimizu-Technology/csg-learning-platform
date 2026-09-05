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

  before_validation :normalize_mention_user_ids
  before_validation :normalize_client_message_id

  validates :body, length: { maximum: 5000 }, allow_blank: true
  validates :client_message_id, length: { maximum: 100 }, uniqueness: { scope: :author_id }, allow_nil: true
  validate :exactly_one_destination
  validate :parent_message_belongs_to_same_channel
  validate :parent_message_is_thread_root
  validate :mention_user_ids_shape

  scope :visible, -> { where(deleted_at: nil) }
  scope :recent, -> { order(created_at: :desc) }
  scope :chronological, -> { order(:created_at, :id) }
  scope :delivery_recovery_due, lambda { |cutoff = MessageDeliveryService::DELIVERY_LEASE.ago|
    where(delivery_tracking_requested: true).where(<<~SQL.squish, cutoff:)
      (notifications_delivered_at IS NULL AND
        (notifications_delivery_started_at IS NULL OR notifications_delivery_started_at <= :cutoff)) OR
      (broadcasts_delivered_at IS NULL AND
        (broadcast_delivery_started_at IS NULL OR broadcast_delivery_started_at <= :cutoff)) OR
      (parent_message_id IS NOT NULL AND thread_broadcasts_delivered_at IS NULL AND
        (thread_broadcast_delivery_started_at IS NULL OR thread_broadcast_delivery_started_at <= :cutoff))
    SQL
  }
  scope :pinned_recent, lambda {
    visible
      .where.not(pinned_at: nil)
      .includes(:author, :message_attachments, :replies, message_reactions: :user)
      .order(pinned_at: :desc, created_at: :desc, id: :desc)
      .limit(PINNED_LIMIT)
  }

  def self.client_message_id_constraint_violation?(error)
    return false unless defined?(PG::Result)

    result = error.cause&.respond_to?(:result) ? error.cause.result : nil
    result&.error_field(PG::Result::PG_DIAG_CONSTRAINT_NAME) == "idx_messages_on_author_and_client_message_id"
  end

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

  def delivered_recipient_ids(attribute)
    values = case attribute
    when :broadcast_recipient_ids then self[:broadcast_recipient_ids]
    when :thread_broadcast_recipient_ids then self[:thread_broadcast_recipient_ids]
    else raise ArgumentError, "unsupported delivery recipient attribute"
    end
    Array(values).map(&:to_i).uniq
  end

  private

  def normalize_client_message_id
    self.client_message_id = client_message_id.to_s.strip.presence
  end

  def normalize_mention_user_ids
    return unless mention_user_ids.is_a?(Array)

    self.mention_user_ids = mention_user_ids.map(&:to_i).uniq
  end

  def mention_user_ids_shape
    ids = mention_user_ids
    unless ids.is_a?(Array) && ids.all? { |value| value.is_a?(Integer) || value.to_s.match?(/\A\d+\z/) }
      errors.add(:mention_user_ids, "must be an array of user ids")
    end
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

  def parent_message_is_thread_root
    return if parent_message_id.blank? || parent_message&.parent_message_id.blank?

    errors.add(:parent_message, "must be a thread root")
  end
end
