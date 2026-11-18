module Api
  module V1
    class GithubIdentitiesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      rescue_from ActiveRecord::RecordNotFound do
        render json: { error: "Not found" }, status: :not_found
      end
      rescue_from GithubAppClient::Error do |error|
        render json: { error: error.message }, status: :unprocessable_entity
      end
      rescue_from ActiveRecord::RecordNotUnique do
        render json: { error: "This GitHub account is already connected to another Learn account" }, status: :conflict
      end
      rescue_from ActiveRecord::RecordInvalid do |error|
        message = error.record.errors.of_kind?(:github_user_id, :taken) ? "This GitHub account is already connected to another Learn account" : "GitHub identity could not be saved; reconnect and try again"
        render json: { error: message }, status: :conflict
      end

      def prepare
        enrollment = current_user.enrollments.includes(:cohort).find(params[:enrollment_id])
        render json: GithubIdentityAuthorization.prepare(user: current_user, enrollment: enrollment)
      end

      def callback
        render json: GithubIdentityAuthorization.connect(user: current_user, state: params[:state], code: params[:code])
      end
    end
  end
end
