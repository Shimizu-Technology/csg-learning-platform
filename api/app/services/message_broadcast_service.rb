class MessageBroadcastService
  class << self
    def created(message)
      broadcast("created", message)
    end

    def updated(message)
      broadcast("updated", message)
    end

    def deleted(message)
      broadcast("deleted", message)
    end

    private

    def broadcast(event, message)
      payload = {
        event: event,
        channel_id: message.channel_id,
        direct_conversation_id: message.direct_conversation_id,
        message: MessageJson.render(message, stream_url: true)
      }

      if message.channel
        ChannelMessagesChannel.broadcast_to(message.channel, payload)
      else
        DirectMessagesChannel.broadcast_to(message.direct_conversation, payload)
      end
    end
  end
end
