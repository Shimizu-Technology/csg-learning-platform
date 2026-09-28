module Api
  module V1
    class CourseOfferingsController < ApplicationController
      def index
        offerings = Cohort.where(course_delivery: "self_paced", status: :active, public_checkout_enabled: true).includes(:curriculum, :support_instructor).order(:name)
        render json: { offerings: offerings.map { |cohort|
          {
            id: cohort.id,
            name: cohort.name,
            curriculum_name: cohort.curriculum.name,
            checkout_available: CourseCheckout.enabled? && cohort.purchase_ready?,
            price_cents: cohort.public_price_cents,
            currency: "USD",
            access_months: cohort.self_paced_access_months,
            includes_private_meetings: false,
            instructor_message_weeks: cohort.self_paced_support_weeks,
            instructor_response_target: "2 Guam business days",
            includes_individual_project_review: false
          }
        } }
      end
    end
  end
end
