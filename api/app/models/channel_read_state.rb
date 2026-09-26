class ChannelReadState < ApplicationRecord
  belongs_to :user
  belongs_to :channel
  belongs_to :last_read_message, class_name: "Message", optional: true

  validates :user_id, uniqueness: { scope: :channel_id }

  def mark_read!(message = nil)
    with_lock do
      read_at = message&.created_at || Time.current
      update!(last_read_message: message, last_read_at: read_at) if MessageReadCursor.advances?(self, read_at, message)
    end
  end
end
