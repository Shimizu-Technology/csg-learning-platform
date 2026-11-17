module Api
  module V1
    class SupportQueueController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def show
        unless current_user.staff?
          render_forbidden("Staff access required")
          return
        end

        cohort = Cohort.find_by(id: params[:cohort_id]) if params[:cohort_id].present?
        if params[:cohort_id].present? && !require_cohort_access!(cohort, teacher: true)
          return
        end

        cohort_ids = cohort ? [ cohort.id ] : current_user.accessible_cohorts.select(:id)
        # Help on one lesson or one module (L-3.2): the "open help" counts on content pages link here.
        render json: { support_queue: SupportQueueProjection.new(cohort_ids: cohort_ids, lesson_id: params[:lesson_id], module_id: params[:module_id]).call }
      end
    end
  end
end
