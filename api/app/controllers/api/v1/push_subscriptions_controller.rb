require "json"

module Api
  module V1
    class PushSubscriptionsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/push_subscriptions/config
      def config
        public_key = safe_env_value("WEB_PUSH_PUBLIC_KEY")
        private_key = safe_env_value("WEB_PUSH_PRIVATE_KEY")
        subject = safe_env_value("WEB_PUSH_SUBJECT")
        missing = []
        missing << "WEB_PUSH_PUBLIC_KEY" if public_key.empty?
        missing << "WEB_PUSH_PRIVATE_KEY" if private_key.empty?
        missing << "WEB_PUSH_SUBJECT" if subject.empty?

        render_push_config(
          configured: missing.empty?,
          public_key: public_key.empty? ? nil : public_key,
          missing: missing,
          notifications_enabled: current_user.message_email_notifications_enabled?,
          active_subscription_count: current_user.push_subscriptions.active.count
        )
      rescue => e
        Rails.logger.error("[PushSubscriptionsController] config failed: #{e.class} #{e.message}")
        render_push_config(
          configured: false,
          public_key: nil,
          missing: [ "push_config_error" ]
        )
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
          current_user.update!(message_email_notifications_enabled: true) unless current_user.message_email_notifications_enabled?
          head new_subscription ? :created : :ok
        else
          render json: { errors: subscription.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/push_subscriptions
      def destroy
        if global_disable?
          current_user.push_subscriptions.destroy_all
          current_user.update!(message_email_notifications_enabled: false)
        elsif params[:endpoint].present?
          current_user.push_subscriptions.where(endpoint: params[:endpoint].to_s).destroy_all
          unless current_user.push_subscriptions.active.exists?
            current_user.update!(message_email_notifications_enabled: false)
          end
        end

        head :no_content
      end

      private

      def render_push_config(payload)
        response.status = :ok
        response.content_type = "application/json"
        self.response_body = JSON.generate(payload)
      end

      def safe_env_value(name)
        ENV.fetch(name, "").to_s.encode("UTF-8", invalid: :replace, undef: :replace, replace: "").strip
      end

      def global_disable?
        ActiveModel::Type::Boolean.new.cast(params[:all])
      end

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
