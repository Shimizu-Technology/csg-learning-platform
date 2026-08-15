module Api
  module V1
    class CohortLearningInsightsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!

      def show
        cohort = Cohort.includes(:curriculum).find(params[:cohort_id])
        if params[:user_id].present? && !cohort.enrollments.exists?(user_id: params[:user_id])
          render json: { error: "Student is not enrolled in this cohort" }, status: :not_found
          return
        end

        render json: {
          learning_insights: LearningInsightsProjection.new(cohort: cohort, user_id: params[:user_id]).call
        }
      end
    end
  end
end
