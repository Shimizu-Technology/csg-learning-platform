require "set"

class MessageBroadcastService
  class BroadcastFailures < StandardError; end

  class << self
    def created(message, **options, &block)
      broadcast("created", message, **options, &block)
    end

    def updated(message, **options, &block)
      broadcast("updated", message, **options, &block)
    end

    def deleted(message, **options, &block)
      broadcast("deleted", message, **options, &block)
    end

    private

    def broadcast(event, message, skip_user_ids: [], raise_on_failure: false, &block)
      # Per-user delivery is intentional: block state changes the serialized
      # message and must never leak blocked text or attachment URLs through a
      # shared conversation broadcast.
      broadcast_to_recipients(event, message, skip_user_ids:, raise_on_failure:, &block)
    end

    def broadcast_to_recipients(event, message, skip_user_ids:, raise_on_failure:, &block)
      failures = []
      skipped_recipients = skip_user_ids.to_set
      message.destination.recipients.find_each do |user|
        next if skipped_recipients.include?(user.id)

        begin
          # The event is sent before its durable recipient checkpoint. This is
          # at-least-once delivery, so consumers must deduplicate retried events.
          UserMessagesChannel.broadcast_to(user, payload_for_user(event, message, user))
        rescue StandardError => e
          log_failure(e, user)
          failures << e
          next
        end
        block&.call(user)
      end
      if raise_on_failure && failures.any?
        count = failures.size
        raise BroadcastFailures, "#{count} recipient broadcast #{count == 1 ? 'failure' : 'failures'}", cause: failures.first
      end
    end

    def log_failure(e, user)
      Rails.logger.warn("MessageBroadcastService: broadcast failed user_id=#{user.id}: #{e.class}: #{e.message}")
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
        latest_message: MessageJson.latest(channel.messages.visible.includes(:author, :message_attachments).order(created_at: :desc, id: :desc).first, current_user: user),
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
        latest_message: MessageJson.latest(conversation.messages.visible.includes(:author, :message_attachments).order(created_at: :desc, id: :desc).first, current_user: user),
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
