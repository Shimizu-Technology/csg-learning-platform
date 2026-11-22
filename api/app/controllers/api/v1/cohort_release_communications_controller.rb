module Api
  module V1
    class CohortReleaseCommunicationsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!

      def show
        cohort = Cohort.includes(:curriculum, :cohort_module_schedules).find_by(id: params[:cohort_id])
        unless cohort
          render json: { error: "Cohort not found" }, status: :not_found
          return
        end

        unless StaffCohortScope.new(current_user).visible?(cohort.id)
          render_forbidden("Cannot access this cohort")
          return
        end

        render json: {
          release_communications: CohortReleaseCommunications.new(cohort: cohort).call
        }
      end
    end
  end
end
