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
      ChannelMessagesChannel.broadcast_to(
        message.channel,
        {
          event: event,
          channel_id: message.channel_id,
          message: message_json(message)
        }
      )
    end

    def message_json(message)
      {
        id: message.id,
        channel_id: message.channel_id,
        body: message.body,
        edited_at: message.edited_at,
        deleted_at: message.deleted_at,
        created_at: message.created_at,
        updated_at: message.updated_at,
        author: {
          id: message.author.id,
          full_name: message.author.full_name,
          email: message.author.email,
          role: message.author.role,
          avatar_url: message.author.avatar_url
        }
      }
    end
  end
end
