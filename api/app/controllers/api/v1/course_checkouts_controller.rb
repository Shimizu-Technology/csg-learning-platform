module Api
  module V1
    class CourseCheckoutsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_student!

      def create
        cohort = Cohort.find(params.require(:cohort_id))
        render json: { url: CourseCheckout.start!(user: current_user, cohort: cohort) }
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Course not found" }, status: :not_found
      rescue CourseCheckout::Unavailable => error
        render json: { error: error.message }, status: :unprocessable_entity
      rescue Stripe::StripeError => error
        Rails.logger.error("[CourseCheckout] stripe_error=#{error.class.name}")
        render json: { error: "Checkout is temporarily unavailable" }, status: :service_unavailable
      end
    end
  end
end
