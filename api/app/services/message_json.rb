class MessageJson
  class << self
    def render(message, current_user: nil, stream_url: false)
      {
        id: message.id,
        channel_id: message.channel_id,
        direct_conversation_id: message.direct_conversation_id,
        parent_message_id: message.parent_message_id,
        body: message.body.to_s,
        edited_at: message.edited_at,
        deleted_at: message.deleted_at,
        pinned_at: message.pinned_at,
        pinned_by_id: message.pinned_by_id,
        created_at: message.created_at,
        updated_at: message.updated_at,
        mine: current_user && message.author_id == current_user.id,
        author: user_json(message.author),
        attachments: message.message_attachments.map { |attachment| attachment_json(attachment, stream_url: stream_url) },
        reactions: reaction_json(message, current_user)
      }
    end

    def latest(message)
      return nil unless message

      {
        id: message.id,
        body: message.body.presence || attachment_preview(message),
        created_at: message.created_at,
        author_name: message.author.full_name
      }
    end

    private

    def attachment_preview(message)
      count = message.message_attachments.size
      return "Attachment" if count == 1

      "#{count} attachments"
    end

    def attachment_json(attachment, stream_url: false)
      json = {
        id: attachment.id,
        filename: attachment.filename,
        content_type: attachment.content_type,
        byte_size: attachment.byte_size,
        image: attachment.image?
      }
      json[:url] = S3Service.generate_presigned_url(attachment.s3_key, expires_in: 900) if stream_url && S3Service.configured?
      json
    end

    def reaction_json(message, current_user)
      message.message_reactions.group_by(&:emoji).map do |emoji, reactions|
        {
          emoji: emoji,
          count: reactions.size,
          reacted: current_user ? reactions.any? { |reaction| reaction.user_id == current_user.id } : false
        }
      end
    end

    def user_json(user)
      {
        id: user.id,
        full_name: user.full_name,
        email: user.email,
        role: user.role,
        avatar_url: user.avatar_url
      }
    end
  end
end
