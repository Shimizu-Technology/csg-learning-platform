module Api
  module V1
    class GithubWebhooksController < ApplicationController
      # Signature verification (raw-body HMAC-SHA256) is this endpoint's
      # authentication; Clerk JWT authentication is intentionally not applied.
      def create
        result = GithubWebhookReceiver.new(
          raw_body: request.raw_post,
          headers: request.headers
        ).call
        render json: result.body, status: result.status
      rescue ActiveRecord::ActiveRecordError => error
        Rails.logger.error("[GithubWebhooks] storage_error class=#{error.class.name}")
        render json: { error: "Webhook storage temporarily unavailable" }, status: :service_unavailable
      end
    end
  end
end
