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
        safe_broadcast { ChannelMessagesChannel.broadcast_to(message.channel, payload) }
      else
        safe_broadcast { DirectMessagesChannel.broadcast_to(message.direct_conversation, payload) }
      end

      broadcast_to_recipients(event, message)
    end

    def broadcast_to_recipients(event, message)
      message.destination.recipients.find_each do |user|
        safe_broadcast { UserMessagesChannel.broadcast_to(user, payload_for_user(event, message, user)) }
      end
    end

    def safe_broadcast
      yield
    rescue StandardError => e
      Rails.logger.warn("MessageBroadcastService: broadcast failed: #{e.class}: #{e.message}")
    end

    def payload_for_user(event, message, user)
      {
        event: event,
        channel_id: message.channel_id,
        direct_conversation_id: message.direct_conversation_id,
        message: MessageJson.render(message, current_user: user, stream_url: true, read_receipts: read_receipts_for(message, user)),
        channel: message.channel && channel_json(message.channel, user),
        direct_conversation: message.direct_conversation && direct_conversation_json(message.direct_conversation, user)
      }
    end

    def channel_json(channel, user)
      read_state = user.channel_read_states.find_by(channel: channel)

      {
        id: channel.id,
        workspace_id: channel.workspace_id,
        workspace_name: channel.workspace.name,
        workspace_type: channel.workspace.workspace_type,
        cohort_id: channel.cohort_id,
        cohort_name: channel.cohort&.name,
        name: channel.name,
        description: channel.description,
        visibility: channel.visibility,
        status: channel.status,
        position: channel.position,
        muted: muted?(user, channel),
        unread_count: channel_unread_count(channel, user, read_state),
        last_read_at: read_state&.last_read_at,
        latest_message: MessageJson.latest(channel.messages.visible.includes(:author, :message_attachments).order(created_at: :desc, id: :desc).first),
        created_at: channel.created_at,
        updated_at: channel.updated_at
      }
    end

    def direct_conversation_json(conversation, user)
      member = conversation.direct_conversation_members.find_by(user: user)

      {
        id: conversation.id,
        workspace_id: conversation.workspace_id,
        workspace_name: conversation.workspace.name,
        workspace_type: conversation.workspace.workspace_type,
        cohort_id: conversation.cohort_id,
        cohort_name: conversation.cohort&.name,
        title: conversation.title_for(user),
        status: conversation.status,
        muted: muted?(user, conversation),
        unread_count: direct_unread_count(conversation, user, member),
        last_read_at: member&.last_read_at,
        latest_message: MessageJson.latest(conversation.messages.visible.includes(:author, :message_attachments).order(created_at: :desc, id: :desc).first),
        users: conversation.users.map { |member_user| user_json(member_user) },
        created_at: conversation.created_at,
        updated_at: conversation.updated_at
      }
    end

    def channel_unread_count(channel, user, read_state)
      messages = channel.messages.visible.where.not(author_id: user.id)
      messages = messages.where("created_at > ?", read_state.last_read_at) if read_state&.last_read_at
      messages.count
    end

    def direct_unread_count(conversation, user, member)
      messages = conversation.messages.visible.where.not(author_id: user.id)
      messages = messages.where("created_at > ?", member.last_read_at) if member&.last_read_at
      messages.count
    end

    def muted?(user, target)
      MessagePreference.exists?(user: user, target: target, muted: true)
    end

    def user_json(user)
      {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url,
        is_staff: user.staff?,
        is_admin: user.admin?
      }
    end

    def read_receipts_for(message, user)
      return nil unless message.author_id == user.id

      readers =
        if message.channel
          member_ids = message.channel.workspace.recipient_users.reorder(nil).where.not(id: message.author_id).select(:id)
          ChannelReadState.includes(:user)
            .where(channel: message.channel, user_id: member_ids)
            .where("last_read_at >= ?", message.created_at)
            .to_a
        else
          message.direct_conversation.direct_conversation_members.includes(:user)
            .where.not(user_id: message.author_id)
            .where("last_read_at >= ?", message.created_at)
            .to_a
        end

      {
        count: readers.size,
        users: readers.first(5).map { |reader| receipt_user_json(reader.user) }
      }
    end

    def receipt_user_json(user)
      {
        id: user.id,
        full_name: user.full_name,
        avatar_url: user.avatar_url
      }
    end
  end
end
