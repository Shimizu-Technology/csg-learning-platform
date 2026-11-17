module Api
  module V1
    class CourseOfferingsController < ApplicationController
      def index
        render json: { public_catalog_mode: SchoolSetting.current.public_catalog_mode,
          offerings: offerings.select(&:published_selected_content?).map { |cohort| PublicCourseSerializer.call(cohort) } }
      end

      def show
        cohort = offerings.find_by!(public_slug: params[:slug])
        raise ActiveRecord::RecordNotFound unless cohort.published_selected_content?
        render json: { offering: PublicCourseSerializer.call(cohort) }
      end

      private

      def offerings
        Cohort.active.where(course_delivery: "self_paced", public_checkout_enabled: true)
          .where.not(public_slug: nil)
          .joins(:curriculum).merge(Curriculum.active).includes(:curriculum, :support_instructor).order(:id)
      end
    end
  end
end
