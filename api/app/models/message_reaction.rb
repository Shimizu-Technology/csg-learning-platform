class MessageReaction < ApplicationRecord
  belongs_to :message
  belongs_to :user

  validates :emoji, presence: true, length: { maximum: 32 }
  validates :emoji, uniqueness: { scope: [ :message_id, :user_id ] }
end
