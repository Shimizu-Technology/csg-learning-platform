module Api
  module V1
    # Admins manage only their own assistant posting tokens. The plaintext is
    # returned once from create and never stored or shown again.
    class AgentPostingTokensController < ApplicationController
      MAX_EXPIRY_DAYS = 365

      before_action :require_admin!
      include AuthenticatedRateLimits
      before_action :disable_caching

      # GET /api/v1/agent_posting_tokens
      def index
        tokens = current_user.agent_posting_tokens.newest_first
        render json: { agent_posting_tokens: tokens.map { |token| token_json(token) } }
      end

      # POST /api/v1/agent_posting_tokens
      def create
        expires_at = requested_expiry
        return if performed?

        record, plaintext = AgentPostingToken.issue!(user: current_user, name: params[:name], expires_at: expires_at)
        render json: { agent_posting_token: token_json(record), token: plaintext }, status: :created
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      end

      # PATCH /api/v1/agent_posting_tokens/:id/revoke
      def revoke
        token = current_user.agent_posting_tokens.find_by(id: params[:id])
        unless token
          render json: { error: "Token not found" }, status: :not_found
          return
        end

        token.revoke!
        render json: { agent_posting_token: token_json(token.reload) }
      end

      private

      def disable_caching
        response.headers["Cache-Control"] = "no-store"
      end

      def requested_expiry
        days = params[:expires_in_days]
        return nil if days.blank?

        unless days.to_s.match?(/\A\d+\z/) && days.to_i.between?(1, MAX_EXPIRY_DAYS)
          render json: { errors: [ "Expiry must be between 1 and #{MAX_EXPIRY_DAYS} days, or empty for no expiry" ] }, status: :unprocessable_entity
          return nil
        end

        days.to_i.days.from_now
      end

      def token_json(token)
        {
          id: token.id,
          name: token.name,
          scope: token.scope,
          status: token.status,
          token_hint: "#{AgentPostingToken::PREFIX}...",
          created_at: token.created_at,
          last_used_at: token.last_used_at,
          expires_at: token.expires_at,
          revoked_at: token.revoked_at
        }
      end
    end
  end
end
