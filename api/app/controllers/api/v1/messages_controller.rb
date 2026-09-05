module Api
  module V1
    class MessagesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_channel, only: [ :create ]
      before_action :set_direct_conversation, only: [ :create_direct ]
      before_action :set_message, only: [ :thread, :update, :destroy, :pin, :unpin, :react, :unreact ]
      before_action :require_community_terms!, only: [ :create, :create_direct, :update, :react ]

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
        return unless deliver_committed_message(@message)

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

      def send_push?
        ActiveModel::Type::Boolean.new.cast(params.fetch(:send_push, true))
      end

      def message_channel_editable?
        destination = @message.destination
        destination.active? && destination.visible_to?(current_user)
      end

      def create_message_for(destination)
        attachments = Array(message_params[:attachments])
        mention_user_ids = sanitized_mention_user_ids_for(destination)
        return if performed?

        existing = existing_message_for_client_id
        if existing
          render_existing_message(existing, destination, attachments, mention_user_ids)
          return
        end

        if message_params[:body].to_s.strip.blank? && attachments.empty?
          render json: { errors: [ "Message must include text or an attachment" ] }, status: :unprocessable_entity
          return
        end

        begin
          attachments.each { |attachment| validate_uploaded_attachment!(attachment) }
        rescue ActiveRecord::RecordInvalid => e
          render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
          return
        end

        message = destination.messages.new(
          body: message_params[:body].to_s,
          parent_message_id: message_params[:parent_message_id],
          client_message_id: message_params[:client_message_id],
          mention_user_ids: mention_user_ids,
          delivery_push_requested: send_push?,
          delivery_tracking_requested: true
        )
        message.author = current_user

        begin
          Message.transaction(requires_new: true) do
            message.save!
            persist_files!(message, attachments)
          end
        rescue ActiveRecord::RecordNotUnique => e
          raise unless client_message_id_unique_violation?(e)

          existing = existing_message_for_client_id
          raise unless existing

          render_existing_message(existing, destination, attachments, mention_user_ids)
          return
        rescue ActiveRecord::RecordInvalid => e
          if duplicate_client_message_id_error?(e, message) && (existing = existing_message_for_client_id)
            render_existing_message(existing, destination, attachments, mention_user_ids)
          else
            render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
          end
          return
        end

        mark_read_for(message)
        return unless deliver_committed_message(message)

        render json: { message: message_json(message.reload) }, status: :created
      end

      def existing_message_for_client_id
        client_message_id = message_params[:client_message_id].to_s.strip
        return if client_message_id.blank?

        current_user.messages.find_by(client_message_id: client_message_id)
      end

      def render_existing_message(message, destination, attachments, mention_user_ids)
        unless same_message_intent?(message, destination, attachments, mention_user_ids)
          render json: { errors: [ "Client message ID has already been used for a different message" ] }, status: :conflict
          return
        end

        mark_read_for(message)
        return unless deliver_committed_message(message)

        render json: { message: message_json(message.reload) }, status: :ok
      end

      def duplicate_client_message_id_error?(error, message)
        error.record.is_a?(Message) &&
          message.client_message_id.present? &&
          error.record.client_message_id == message.client_message_id &&
          error.record.errors.details.fetch(:client_message_id, []).any? { |detail| detail[:error] == :taken }
      end

      def client_message_id_unique_violation?(error)
        Message.client_message_id_constraint_violation?(error)
      end

      def same_message_intent?(message, destination, attachments, mention_user_ids)
        persisted_mention_user_ids = Array(message.mention_user_ids).map(&:to_i)
        # Raw IDs preserve the original intent when a mentioned member leaves;
        # sanitized IDs still reject any newly valid mention added on replay.
        message.deleted_at.nil? &&
          message.destination == destination &&
          message.body.to_s == message_params[:body].to_s &&
          message.parent_message_id == Message.type_for_attribute(:parent_message_id).cast(message_params[:parent_message_id]) &&
          (persisted_mention_user_ids - requested_mention_user_ids).empty? &&
          (mention_user_ids - persisted_mention_user_ids).empty? &&
          persisted_attachment_intent(message) == requested_attachment_intent(attachments)
      end

      def deliver_committed_message(message)
        MessageDeliveryService.created(message)
        true
      rescue StandardError => error
        Rails.logger.error(
          "[MessagesController] delivery_deferred message_id=#{message.id} " \
          "error_class=#{error.class.name}"
        )
        # Solid Queue owns durable recovery after the committed write. Inline
        # deployments have no sweep, so the client must retry the same
        # client_message_id instead of treating incomplete fan-out as success.
        return true if ActiveJob::Base.queue_adapter_name == "solid_queue"

        render json: { errors: [ "Message was saved but delivery is still pending; try again" ] }, status: :service_unavailable
        false
      end

      def persisted_attachment_intent(message)
        message.message_attachments.map do |attachment|
          [ attachment.s3_key, attachment.filename, attachment.content_type, attachment.byte_size ]
        end.sort
      end

      def requested_attachment_intent(attachments)
        attachments.map do |attachment|
          [ attachment[:s3_key].to_s, attachment[:filename].to_s, attachment[:content_type].to_s, attachment[:byte_size].to_i ]
        end.sort
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
        raw_ids = requested_mention_user_ids
        return [] if raw_ids.empty?

        allowed_ids = destination.recipients.reorder(nil).where(id: raw_ids).pluck(:id)
        allowed_ids.reject { |id| id == current_user.id }
      end

      def requested_mention_user_ids
        values = Array(message_params[:mention_user_ids]).reject(&:blank?)
        unless values.all? { |value| value.is_a?(Integer) || value.to_s.match?(/\A\d+\z/) }
          render json: { errors: [ "Mention user IDs must be numeric" ] }, status: :unprocessable_entity
          return []
        end

        values.map(&:to_i).uniq
      end

      def message_json(message)
        MessageJson.render(message, current_user: current_user, stream_url: true)
      end

      def thread_root(message)
        message.parent_message || message
      end
    end
  end
end
