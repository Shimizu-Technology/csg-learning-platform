module Api
  module V1
    class CourseOfferingsController < ApplicationController
      def index
        render json: { public_catalog_mode: SchoolSetting.current.public_catalog_mode,
          offerings: offerings.map { |cohort| PublicCourseSerializer.call(cohort) } }
      end

      def show
        cohort = offerings.find { |entry| entry.public_slug == params[:slug] } || raise(ActiveRecord::RecordNotFound)
        render json: { offering: PublicCourseSerializer.call(cohort) }
      end

      private

      def offerings
        Cohort.active.where(course_delivery: "self_paced", public_checkout_enabled: true)
          .joins(:curriculum).merge(Curriculum.active).includes(:curriculum, :support_instructor).order(:id)
          .select { |cohort| cohort.published_selected_content? }
      end
    end
  end
end
