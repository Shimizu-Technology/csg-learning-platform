module Api
  module V1
    class WeeklyPlansController < ApplicationController
      before_action :authenticate_user!

      def show
        unless current_user.student?
          render_forbidden("Weekly plans are available to students")
          return
        end

        if params[:cohort_id].present? && !current_user.can_access_cohort?(Cohort.find_by(id: params[:cohort_id]))
          render_forbidden("Cannot access this cohort")
          return
        end

        current_user.enrollments.find_by(cohort_id: params[:cohort_id])&.mark_joined! if params[:cohort_id].present?

        render json: { weekly_plan: WeeklyPlanProjection.new(current_user, cohort_id: params[:cohort_id]).call }
      end
    end
  end
end
