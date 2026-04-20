module Api
  module V1
    class PushSubscriptionsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/push_subscriptions/config
      def config
        render json: {
          configured: WebPushNotificationService.configured?,
          public_key: ENV["WEB_PUSH_PUBLIC_KEY"]
        }
      end

      # POST /api/v1/push_subscriptions
      def create
        subscription = PushSubscription.find_or_initialize_by(endpoint: subscription_params[:endpoint])
        new_subscription = subscription.new_record?
        if subscription.persisted? && subscription.user_id != current_user.id
          head :conflict
          return
        end

        subscription.user = current_user
        subscription.p256dh = subscription_params[:p256dh]
        subscription.auth = subscription_params[:auth]
        subscription.user_agent = request.user_agent
        subscription.last_seen_at = Time.current
        subscription.failed_at = nil

        if subscription.save
          head new_subscription ? :created : :ok
        else
          render json: { errors: subscription.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/push_subscriptions
      def destroy
        current_user.push_subscriptions.where(endpoint: params[:endpoint].to_s).destroy_all
        head :no_content
      end

      private

      def subscription_params
        keys = params.require(:keys).permit(:p256dh, :auth)
        {
          endpoint: params[:endpoint].to_s,
          p256dh: keys[:p256dh].to_s,
          auth: keys[:auth].to_s
        }
      end
    end
  end
end
