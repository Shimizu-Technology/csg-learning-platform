class ChannelReadState < ApplicationRecord
  belongs_to :user
  belongs_to :channel
  belongs_to :last_read_message, class_name: "Message", optional: true

  validates :user_id, uniqueness: { scope: :channel_id }

  def mark_read!(message = nil)
    with_lock do
      read_at = message&.created_at || Time.current
      next if last_read_at && (last_read_at > read_at || (last_read_at == read_at && (message.nil? || last_read_message_id.nil? || last_read_message_id >= message.id)))

      update!(last_read_message: message, last_read_at: read_at)
    end
  end
end
