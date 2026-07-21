module Api
  module V1
    class MessagesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_channel, only: [ :create ]
      before_action :set_direct_conversation, only: [ :create_direct ]
      before_action :set_message, only: [ :thread, :update, :destroy, :pin, :unpin, :react, :unreact ]

      # GET /api/v1/messages/:id/thread
      def thread
        root = thread_root(@message)
        unless root.destination.visible_to?(current_user)
          render_forbidden("Conversation is not visible")
          return
        end

        replies = root.replies.visible
          .includes(:author, :message_attachments, :replies, message_reactions: :user)
          .chronological

        render json: {
          root_message: message_json(root),
          replies: replies.map { |reply| message_json(reply) }
        }
      end

      # POST /api/v1/channels/:channel_id/messages
      def create
        unless @channel.can_post?(current_user)
          render_forbidden("Cannot post in this channel")
          return
        end

        create_message_for(@channel)
      end

      # POST /api/v1/direct_conversations/:direct_conversation_id/messages
      def create_direct
        unless @direct_conversation.can_post?(current_user)
          render_forbidden("Cannot post in this conversation")
          return
        end

        create_message_for(@direct_conversation)
      end

      # PATCH /api/v1/messages/:id
      def update
        unless message_channel_editable?
          render_forbidden("Cannot edit messages in this channel")
          return
        end

        unless @message.editable_by?(current_user)
          render_forbidden("Cannot edit this message")
          return
        end

        if @message.update(
          body: message_params[:body],
          edited_at: Time.current,
          mention_user_ids: sanitized_mention_user_ids_for(@message.destination)
        )
          MessageBroadcastService.updated(@message)
          render json: { message: message_json(@message) }
        else
          render json: { errors: @message.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/messages/:id
      def destroy
        unless message_channel_editable?
          render_forbidden("Cannot delete messages in this channel")
          return
        end

        unless @message.editable_by?(current_user)
          render_forbidden("Cannot delete this message")
          return
        end

        root = @message.parent_message && thread_root(@message)
        @message.update!(deleted_at: Time.current)
        MessageBroadcastService.deleted(@message)
        MessageBroadcastService.updated(root.reload) if root
        render json: { message: message_json(@message) }
      end

      # PATCH /api/v1/messages/:id/pin
      def pin
        unless message_channel_editable?
          render_forbidden("Cannot pin messages in this conversation")
          return
        end

        unless current_user.staff?
          render_forbidden("Only staff can pin messages")
          return
        end

        @message.update!(pinned_at: Time.current, pinned_by: current_user)
        MessageBroadcastService.updated(@message)
        render json: { message: message_json(@message) }
      end

      # DELETE /api/v1/messages/:id/pin
      def unpin
        unless message_channel_editable?
          render_forbidden("Cannot unpin messages in this conversation")
          return
        end

        unless current_user.staff?
          render_forbidden("Only staff can unpin messages")
          return
        end

        @message.update!(pinned_at: nil, pinned_by: nil)
        MessageBroadcastService.updated(@message)
        render json: { message: message_json(@message) }
      end

      # POST /api/v1/messages/:id/reactions
      def react
        unless message_channel_editable?
          render_forbidden("Cannot react to this message")
          return
        end

        if @message.deleted?
          render_forbidden("Cannot react to deleted messages")
          return
        end

        emoji = reaction_emoji
        return if performed?

        @message.message_reactions.create_or_find_by!(user: current_user, emoji: emoji)
        MessageBroadcastService.updated(@message)
        render json: { message: message_json(@message.reload) }
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      end

      # DELETE /api/v1/messages/:id/reactions
      def unreact
        unless message_channel_editable?
          render_forbidden("Cannot remove reactions from this message")
          return
        end

        if @message.deleted?
          render_forbidden("Cannot remove reactions from deleted messages")
          return
        end

        emoji = reaction_emoji
        return if performed?

        @message.message_reactions.where(user: current_user, emoji: emoji).destroy_all
        MessageBroadcastService.updated(@message)
        render json: { message: message_json(@message.reload) }
      end

      private

      def set_channel
        @channel = Channel.find(params[:channel_id])
      end

      def set_direct_conversation
        @direct_conversation = DirectConversation.find(params[:direct_conversation_id])
      end

      def set_message
        @message = Message.find(params[:id])
      end

      def message_params
        params.permit(:body, :parent_message_id, mention_user_ids: [], attachments: [ :s3_key, :filename, :content_type, :byte_size ])
      end

      def reaction_params
        params.permit(:emoji)
      end

      def reaction_emoji
        emoji = reaction_params[:emoji].to_s.strip
        if emoji.blank?
          render json: { errors: [ "Emoji is required" ] }, status: :unprocessable_entity
          return nil
        end

        emoji
      end

      def send_push?
        ActiveModel::Type::Boolean.new.cast(params.fetch(:send_push, true))
      end

      def message_channel_editable?
        destination = @message.destination
        destination.active? && destination.visible_to?(current_user)
      end

      def create_message_for(destination)
        attachments = Array(message_params[:attachments])

        if message_params[:body].to_s.strip.blank? && attachments.empty?
          render json: { errors: [ "Message must include text or an attachment" ] }, status: :unprocessable_entity
          return
        end

        attachments.each { |attachment| validate_uploaded_attachment!(attachment) }

        message = destination.messages.new(
          body: message_params[:body].to_s,
          parent_message_id: message_params[:parent_message_id],
          mention_user_ids: sanitized_mention_user_ids_for(destination)
        )
        message.author = current_user

        Message.transaction do
          message.save!
          persist_files!(message, attachments)
        end

        mark_read_for(message)
        NotificationDeliveryService.message_created(message, push: send_push?)
        MessageBroadcastService.created(message)
        MessageBroadcastService.updated(thread_root(message).reload) if message.parent_message
        render json: { message: message_json(message.reload) }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      end

      def persist_files!(message, attachments)
        attachments.each do |attachment|
          message.message_attachments.create!(
            uploaded_by: current_user,
            s3_key: attachment[:s3_key],
            filename: attachment[:filename],
            content_type: attachment[:content_type],
            byte_size: attachment[:byte_size]
          )
        end
      end

      def validate_uploaded_attachment!(attachment)
        key = attachment[:s3_key].to_s
        unless key.start_with?(message_attachment_prefix)
          raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment path is not allowed") })
        end

        return unless S3Service.configured?

        metadata = S3Service.object_metadata(key)
        unless metadata
          raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment upload was not found") })
        end

        expected_type = attachment[:content_type].to_s.downcase
        uploaded_type = metadata[:content_type].to_s.downcase.split(";").first.strip
        if uploaded_type != expected_type
          raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment content type does not match upload") })
        end

        if metadata[:content_length].to_i != attachment[:byte_size].to_i
          raise ActiveRecord::RecordInvalid.new(@message || Message.new.tap { |record| record.errors.add(:base, "Attachment size does not match upload") })
        end
      end

      def message_attachment_prefix
        destination = @channel || @direct_conversation || @message&.destination
        destination.is_a?(Channel) ? "message_attachments/channel_#{destination.id}/" : "message_attachments/dm_#{destination.id}/"
      end

      def mark_read_for(message)
        if message.channel
          find_or_create_read_state(message.channel).mark_read!(message)
        else
          message.direct_conversation.direct_conversation_members.find_by!(user: current_user).mark_read!(message)
        end
      end

      def find_or_create_read_state(channel)
        current_user.channel_read_states.find_or_create_by!(channel: channel)
      rescue ActiveRecord::RecordInvalid, ActiveRecord::RecordNotUnique
        current_user.channel_read_states.find_by!(channel: channel)
      end

      def sanitized_mention_user_ids_for(destination)
        raw_ids = Array(message_params[:mention_user_ids]).filter_map do |value|
          next if value.blank?

          value.to_i
        end.uniq
        return [] if raw_ids.empty?

        allowed_ids = destination.recipients.reorder(nil).where(id: raw_ids).pluck(:id)
        allowed_ids.reject { |id| id == current_user.id }
      end

      def message_json(message)
        MessageJson.render(message, current_user: current_user, stream_url: true)
      end

      def thread_root(message)
        current = message
        current = current.parent_message while current.parent_message
        current
      end
    end
  end
end
