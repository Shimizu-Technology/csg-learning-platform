module Api
  module V1
    class StudentCommunicationsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!

      def show
        enrollment = Enrollment.where(cohort_id: StaffCohortScope.new(current_user).visible_cohorts.select(:id))
          .find_by!(user_id: params[:user_id], cohort_id: params.require(:cohort_id))
        render json: { communication: StudentCommunicationProjection.new(enrollment: enrollment, viewer: current_user).call }
      end
    end
  end
end
