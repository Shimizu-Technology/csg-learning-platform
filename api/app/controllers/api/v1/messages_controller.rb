module Api
  module V1
    class MessagesController < ApplicationController
      include MessageWindowing
      include MessageCreation
      before_action :authenticate_user!
      before_action :set_channel, only: [ :create ]
      before_action :set_direct_conversation, only: [ :create_direct ]
      before_action :set_available_message, only: [ :destination, :thread ]
      before_action :set_message, only: [ :update, :destroy, :pin, :unpin, :react, :unreact ]
      before_action :require_community_terms!, only: [ :create, :create_direct, :update, :react ]

      # GET /api/v1/messages/:id/destination — no bodies, attachments or reply collection.
      def destination
        root = thread_root(@message)
        render json: {
          message_id: @message.id,
          thread_root_id: root.id,
          channel_id: root.channel_id,
          direct_conversation_id: root.direct_conversation_id,
          workspace_id: root.destination.workspace_id
        }
      end

      # GET /api/v1/messages/:id/thread
      def thread
        root = thread_root(@message)
        scope = root.replies.visible
        # Installed clients predate pagination and never request a second page.
        window_requested = %i[window message_limit around_message_id before_message_id after_message_id].any? { |key| params.key?(key) }
        params[:around_message_id] = message_anchor(:around_message_id)
        params[:around_message_id] ||= @message.id if @message.parent_message_id
        if params[:around_message_id].present? && params[:around_message_id].to_i != root.id && !scope.exists?(id: params[:around_message_id])
          render json: { error: "This message is no longer available." }, status: :not_found
          return
        end
        replies = window_requested ? windowed_messages(scope) : preload_message_window(scope.order(created_at: :asc, id: :asc).to_a)
        render json: {
          root_message: message_json(root),
          replies: replies.map { |reply| message_json(reply) },
          meta: message_window_meta(scope, replies)
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

        mention_user_ids = sanitized_mention_user_ids_for(@message.destination)
        return if performed?

        if @message.update(
          body: message_params[:body],
          edited_at: Time.current,
          mention_user_ids: mention_user_ids
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

        begin
          MessageDeliveryService.synchronize_delivery(@message) do
            @message.reload
            next if @message.deleted?

            @message.update!(
              deleted_at: Time.current,
              pinned_at: nil,
              pinned_by: nil,
              delivery_tracking_requested: true,
              delivery_recovery_attempted_at: Time.at(0).utc,
              notifications_delivery_claim: nil,
              notifications_delivery_started_at: nil,
              notifications_delivered_at: Time.current,
              broadcast_recipient_ids: [],
              broadcast_delivery_claim: nil,
              broadcast_delivery_started_at: nil,
              broadcasts_delivered_at: nil,
              thread_broadcast_recipient_ids: [],
              thread_broadcast_delivery_claim: nil,
              thread_broadcast_delivery_started_at: nil,
              thread_broadcasts_delivered_at: nil
            )
          end
        rescue MessageDeliveryService::DeliveryLockTimeout
          render json: { errors: [ "Message delivery is still finishing; try again" ] }, status: :service_unavailable
          return
        end
        return unless deliver_committed_message(@message, operation: :destroy)

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

      def set_available_message
        @message = Message.find_by(id: params[:id])
        root = @message && thread_root(@message)
        if !root || @message.deleted? || root.deleted? || !root.destination.visible_to?(current_user)
          render json: { error: "This message is no longer available." }, status: :not_found
        end
      end

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
        params.permit(:body, :parent_message_id, :client_message_id, mention_user_ids: [], attachments: [ :s3_key, :filename, :content_type, :byte_size ])
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

      def message_channel_editable?
        destination = @message.destination
        destination.active? && destination.visible_to?(current_user)
      end

      def thread_root(message)
        message.parent_message || message
      end
    end
  end
end
