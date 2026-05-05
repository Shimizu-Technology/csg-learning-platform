class ReadReceiptBroadcastJob < ApplicationJob
  queue_as :default

  def perform(destination, reader_id, previous_last_read_at = nil)
    messages = destination.messages.visible.where.not(author_id: reader_id)
    messages = messages.where("created_at > ?", previous_last_read_at) if previous_last_read_at.present?

    messages.order(created_at: :desc, id: :desc).limit(50).each do |message|
      MessageBroadcastService.updated(message)
    end
  end
end
