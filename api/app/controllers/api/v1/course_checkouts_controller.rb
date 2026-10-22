module Api
  module V1
    class CourseCheckoutsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_student!
      before_action -> { response.headers["Cache-Control"] = "no-store" }

      def index
        render json: { purchases: current_user.course_purchases.where(status: "pending").map { |purchase|
          { id: purchase.id, cohort_id: purchase.cohort_id }
        } }
      end

      # Local records only: never query Stripe from the confirmation loop.
      def status
        purchases = current_user.course_purchases.includes(:cohort)
        purchase = if params[:id].match?(/\A[1-9]\d*\z/)
          purchases.find_by(id: params[:id])
        else
          purchases.find_by(stripe_session_id: params[:id])
        end
        return render json: { error: "Purchase not found" }, status: :not_found unless purchase

        enrollment = current_user.enrollments.with_read_access.find_by(cohort_id: purchase.cohort_id)
        state = case purchase.checkout_state
        when "paid" then enrollment ? "fulfilled" : "failed"
        when "refunded" then "refunded"
        when "failed", "expired", "disputed" then "failed"
        when "setup_failed", "starting" then purchase.checkout_state
        else "pending"
        end
        render json: { status: state, can_resume: purchase.checkout_resumable?, purchase_id: purchase.id,
          cohort: { id: purchase.cohort_id, name: purchase.cohort.name },
          enrollment_id: state == "fulfilled" ? enrollment.id : nil }
      end

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
