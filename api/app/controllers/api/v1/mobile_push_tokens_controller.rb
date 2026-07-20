module Api
  module V1
    class MobilePushTokensController < ApplicationController
      before_action :authenticate_user!

      # POST /api/v1/mobile_push_tokens
      def create
        existing_token = MobilePushToken.find_by(token: token_params[:token])
        if existing_token && existing_token.user_id != current_user.id
          render json: { error: "Push token is already registered" }, status: :conflict
          return
        end

        token = existing_token || current_user.mobile_push_tokens.new(token: token_params[:token])
        token.assign_attributes(token_params.except(:token))
        token.user = current_user
        token.last_seen_at = Time.current
        token.failed_at = nil

        if token.save
          render json: { mobile_push_token: token_json(token) }, status: token.previously_new_record? ? :created : :ok
        else
          render json: { errors: token.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotUnique
        # Two sessions can attempt the first registration concurrently. The unique
        # index is authoritative and prevents the losing request from reassigning it.
        render json: { error: "Push token is already registered" }, status: :conflict
      end

      # DELETE /api/v1/mobile_push_tokens
      def destroy
        current_user.mobile_push_tokens.where(token: params[:token].to_s).destroy_all
        head :no_content
      end

      private

      def token_params
        params.permit(:token, :platform, :device_id, :app_version)
      end

      def token_json(token)
        {
          id: token.id,
          platform: token.platform,
          device_id: token.device_id,
          app_version: token.app_version,
          last_seen_at: token.last_seen_at
        }
      end
    end
  end
end
