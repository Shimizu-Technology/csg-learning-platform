module Api
  module V1
    module Agent
      # The only endpoint an AgentPostingToken can reach. It deliberately skips
      # Clerk authentication and reuses the human create path (MessageCreation)
      # plus the same destination can_post? checks, so agent posts behave and
      # are authorized exactly like messages the owner sends from the app.
      class MessagesController < ApplicationController
        include MessageCreation

        RATE_LIMIT = 30
        RATE_LIMIT_WINDOW = 1.minute
        # Process-local like production's memory cache store; see API_REFERENCE.
        RATE_LIMIT_STORE = ActiveSupport::Cache::MemoryStore.new
        IDEMPOTENCY_KEY_FORMAT = /\A[A-Za-z0-9._:\-]{8,64}\z/
        DESTINATION_KEYS = %i[channel_id direct_conversation_id recipient_user_id].freeze

        before_action :disable_caching
        before_action :authenticate_agent_token!
        rate_limit to: RATE_LIMIT, within: RATE_LIMIT_WINDOW, store: RATE_LIMIT_STORE,
          by: -> { @agent_posting_token.id },
          with: -> { render json: { error: "Rate limit exceeded; retry later" }, status: :too_many_requests }
        before_action :require_community_terms!
        before_action :require_idempotency_key!
        before_action :reject_attachments!
        before_action :validate_thread_root_id!
        before_action :set_destination

        # POST /api/v1/agent/messages
        def create
          unless @destination.can_post?(current_user)
            render_forbidden(@destination.is_a?(Channel) ? "Cannot post in this channel" : "Cannot post in this conversation")
            return
          end

          create_message_for(@destination)
        end

        private

        def disable_caching
          response.headers["Cache-Control"] = "no-store"
          response.headers["Vary"] = "Authorization"
        end

        def authenticate_agent_token!
          bearer = request.headers["Authorization"].to_s.match(/\ABearer ([^\s]+)\z/)
          @agent_posting_token = AgentPostingToken.authenticate(bearer&.captures&.first)
          unless @agent_posting_token
            render json: { error: "Unauthorized" }, status: :unauthorized
            return
          end

          @current_user = @agent_posting_token.user
          @agent_posting_token.update_column(:last_used_at, Time.current)
        end

        def require_idempotency_key!
          return if idempotency_key.match?(IDEMPOTENCY_KEY_FORMAT)

          render json: {
            error: "Send an Idempotency-Key header of 8-64 letters, digits, '.', '_', ':' or '-'",
            code: "idempotency_key_required"
          }, status: :unprocessable_entity
        end

        def reject_attachments!
          return unless params.key?(:attachments)

          render json: { error: "Attachments are not supported for assistant posts" }, status: :unprocessable_entity
        end

        def validate_thread_root_id!
          value = params[:thread_root_id]
          return if value.blank? || value.to_s.match?(/\A\d+\z/)

          render json: { error: "thread_root_id must be a message ID" }, status: :unprocessable_entity
        end

        def set_destination
          keys = DESTINATION_KEYS.select { |key| params[key].present? }
          unless keys.one?
            render json: { error: "Send exactly one of channel_id, direct_conversation_id or recipient_user_id" }, status: :unprocessable_entity
            return
          end

          @destination = case keys.first
          when :channel_id then @channel = Channel.find_by(id: params[:channel_id])
          when :direct_conversation_id then @direct_conversation = DirectConversation.find_by(id: params[:direct_conversation_id])
          else @direct_conversation = direct_conversation_with_recipient
          end
          return if performed?

          render json: { error: "Destination not found" }, status: :not_found unless @destination
        end

        # Assistants can only post into an existing 1:1 conversation; creating
        # new conversations stays a human action in the app.
        def direct_conversation_with_recipient
          recipient_id = params[:recipient_user_id].to_s
          return unless recipient_id.match?(/\A\d+\z/) && recipient_id.to_i != current_user.id

          scope = DirectConversation.visible_for(current_user)
            .where(member_key: DirectConversation.member_key_for([ current_user.id, recipient_id.to_i ]))
          scope = scope.where(workspace_id: params[:workspace_id]) if params[:workspace_id].present?
          matches = scope.distinct.limit(2).to_a
          return matches.first if matches.size <= 1

          render json: {
            error: "You have more than one conversation with this person; send workspace_id or direct_conversation_id",
            code: "workspace_required"
          }, status: :unprocessable_entity
          nil
        end

        def idempotency_key
          (request.headers["Idempotency-Key"].presence || params[:idempotency_key]).to_s.strip
        end

        def message_params
          @agent_message_params ||= ActionController::Parameters.new(
            body: params[:body],
            parent_message_id: params[:thread_root_id],
            client_message_id: "agent-#{@agent_posting_token.id}:#{idempotency_key}",
            mention_user_ids: params[:mention_user_ids]
          ).permit(:body, :parent_message_id, :client_message_id, mention_user_ids: [])
        end

        def message_creation_attributes
          { agent_posting_token: @agent_posting_token, sent_via_label: @agent_posting_token.name }
        end

        # Echo only what the caller sent plus identifiers; posting does not
        # grant reads of reactions, replies or other members' data.
        def message_json(message)
          {
            id: message.id,
            channel_id: message.channel_id,
            direct_conversation_id: message.direct_conversation_id,
            thread_root_id: message.parent_message_id,
            body: message.body.to_s,
            sent_via_label: message.sent_via_label,
            created_at: message.created_at
          }
        end
      end
    end
  end
end
