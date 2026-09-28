module Api
  module V1
    class SupportQueueController < ApplicationController
      before_action :authenticate_user!

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
        render json: { support_queue: SupportQueueProjection.new(cohort_ids: cohort_ids).call }
      end
    end
  end
end
