module Api
  module V1
    class MessagesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_channel, only: [ :create ]
      before_action :set_message, only: [ :update, :destroy ]

      # POST /api/v1/channels/:channel_id/messages
      def create
        unless @channel.can_post?(current_user)
          render_forbidden("Cannot post in this channel")
          return
        end

        message = @channel.messages.new(message_params)
        message.author = current_user

        if message.save
          current_user.channel_read_states.create_or_find_by!(channel: @channel).mark_read!(message)
          NotificationDeliveryService.message_created(message, push: send_push?)
          MessageBroadcastService.created(message)
          render json: { message: message_json(message) }, status: :created
        else
          render json: { errors: message.errors.full_messages }, status: :unprocessable_entity
        end
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

        if @message.update(body: message_params[:body], edited_at: Time.current)
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

        @message.update!(deleted_at: Time.current)
        MessageBroadcastService.deleted(@message)
        render json: { message: message_json(@message) }
      end

      private

      def set_channel
        @channel = Channel.find(params[:channel_id])
      end

      def set_message
        @message = Message.find(params[:id])
      end

      def message_params
        params.permit(:body, :parent_message_id)
      end

      def send_push?
        ActiveModel::Type::Boolean.new.cast(params.fetch(:send_push, true))
      end

      def message_channel_editable?
        @message.channel.active? && @message.channel.visible_to?(current_user)
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
          mine: message.author_id == current_user.id,
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
end
