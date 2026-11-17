module Api
  module V1
    class CourseCheckoutsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_student!
      before_action -> { response.headers["Cache-Control"] = "no-store" }

      def index
        render json: { purchases: current_user.course_purchases.where(status: %w[pending expired]).map { |purchase|
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
        render json: { status: state, can_resume: purchase.checkout_resumable?,
          can_continue: purchase.status == "expired" || (purchase.status == "pending" && purchase.stripe_session_id.present?), purchase_id: purchase.id,
          cohort: { id: purchase.cohort_id, name: purchase.cohort.public_title.presence || "Self-paced course" },
          enrollment_id: state == "fulfilled" ? enrollment.id : nil }
      end

      # Only an explicit click asks Stripe; profile loading remains local and batched.
      def receipt
        purchase = current_user.course_purchases.find(params[:id])
        return render json: { error: "Receipt unavailable. Contact CSG for a copy." }, status: :not_found unless purchase.status == "paid" && purchase.stripe_payment_intent_id.present?

        intent = CourseCheckout.client.v1.payment_intents.retrieve(purchase.stripe_payment_intent_id, { expand: [ "latest_charge" ] })
        url = intent.latest_charge&.receipt_url
        return render json: { error: "Receipt unavailable. Contact CSG for a copy." }, status: :not_found unless url.present? && URI.parse(url).is_a?(URI::HTTPS)

        render json: { url: url }
      rescue URI::InvalidURIError
        render json: { error: "Receipt unavailable. Contact CSG for a copy." }, status: :not_found
      rescue Stripe::StripeError
        render json: { error: "Receipt could not load. Try again or contact CSG for a copy." }, status: :service_unavailable
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
