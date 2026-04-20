class DirectConversation < ApplicationRecord
  enum :status, { active: 0, archived: 1 }

  belongs_to :cohort
  has_many :direct_conversation_members, dependent: :destroy
  has_many :users, through: :direct_conversation_members
  has_many :messages, dependent: :destroy
  has_many :message_preferences, as: :target, dependent: :destroy

  validates :member_key, presence: true, uniqueness: { scope: :cohort_id }

  scope :visible_for, ->(user) {
    joins(:direct_conversation_members)
      .where(direct_conversation_members: { user_id: user.id })
      .active
  }

  def self.member_key_for(user_ids)
    user_ids.map(&:to_i).uniq.sort.join(":")
  end

  def self.find_or_create_for!(cohort:, users:)
    user_ids = users.map(&:id).uniq.sort
    member_key = member_key_for(user_ids)
    conversation = cohort.direct_conversations.find_by(member_key: member_key)
    return conversation if conversation

    transaction do
      create_or_find_by!(cohort: cohort, member_key: member_key).tap do |conversation_record|
        user_ids.each do |user_id|
          conversation_record.direct_conversation_members.create_or_find_by!(user_id: user_id)
        end
      end
    end
  end

  def visible_to?(user)
    return false unless user

    direct_conversation_members.exists?(user_id: user.id)
  end

  def can_post?(user)
    active? && visible_to?(user)
  end

  def recipients
    users
  end

  def title_for(user)
    users.where.not(id: user.id).map(&:full_name).join(", ")
  end
end
