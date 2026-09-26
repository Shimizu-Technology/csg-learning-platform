class ReadReceiptBroadcastJob < ApplicationJob
  queue_as :default

  def perform(destination, reader_id, previous_last_read_at = nil, last_read_at = nil, previous_last_read_message_id = nil, last_read_message_id = nil)
    messages = destination.messages.visible.where.not(author_id: reader_id)
    previous_cursor = Struct.new(:last_read_at, :last_read_message_id).new(previous_last_read_at, previous_last_read_message_id)
    messages = MessageReadCursor.after(messages, previous_cursor)
    if last_read_at.present?
      current_cursor = Struct.new(:last_read_at, :last_read_message_id).new(last_read_at, last_read_message_id)
      messages = MessageReadCursor.through(messages, current_cursor)
    end

    messages.order(created_at: :desc, id: :desc).limit(50).each do |message|
      MessageBroadcastService.updated(message)
    end
  end
end
