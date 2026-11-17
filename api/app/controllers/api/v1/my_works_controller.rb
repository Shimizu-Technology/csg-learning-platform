module Api
  module V1
    # My work (L-1.2): a learner's own submitted work in one cohort they can
    # read, from MyWork. Learners only; staff read work through Grading and
    # the student page.
    class MyWorksController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      # GET /api/v1/my_work
      def show
        cohort = Cohort.find_by(id: params[:cohort_id]) if params[:cohort_id].present?
        if params[:cohort_id].present? && !current_user.can_access_cohort?(cohort)
          render_forbidden("Cannot access this cohort")
          return
        end
        return render_forbidden("My work is for learners") if current_user.staff?

        scope = current_user.enrollments.with_read_access.includes(*CourseOutlinesController::INCLUDES)
        enrollment = cohort ? scope.find_by(cohort_id: cohort.id) : scope.order(:status).first
        return render(json: { error: "No enrollment to show" }, status: :not_found) unless enrollment

        render json: { my_work: MyWork.new(enrollment).call }
      end
    end
  end
end
