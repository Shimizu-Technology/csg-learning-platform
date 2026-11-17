module Api
  module V1
    # The redesigned Learn page's data (CourseOutline). Learners read their own
    # outline in a cohort they can read; staff read one enrolled learner's
    # outline (`student_id`) in a cohort they can access, for View as student.
    class CourseOutlinesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      INCLUDES = [ :module_assignments, :lesson_assignments, :learning_plan,
        { cohort: [ :cohort_module_schedules, :cohort_module_submission_windows, { curriculum: { modules: { lessons: :content_blocks } } } ] } ].freeze

      # GET /api/v1/course_outline
      def show
        cohort = Cohort.find_by(id: params[:cohort_id]) if params[:cohort_id].present?
        if params[:cohort_id].present? && !current_user.can_access_cohort?(cohort)
          render_forbidden("Cannot access this cohort")
          return
        end

        enrollment = current_user.staff? ? staff_enrollment(cohort) : learner_enrollment(cohort)
        return if performed?
        return render(json: { error: "No enrollment to show" }, status: :not_found) unless enrollment

        render json: { outline: CourseOutline.new(enrollment).call }
      end

      private

      def learner_enrollment(cohort)
        scope = current_user.enrollments.with_read_access.includes(*INCLUDES)
        cohort ? scope.find_by(cohort_id: cohort.id) : scope.order(:status).first
      end

      def staff_enrollment(cohort)
        unless cohort && params[:student_id].present?
          render json: { error: "Choose a cohort and a student" }, status: :unprocessable_entity
          return
        end

        cohort.enrollments.includes(*INCLUDES).find_by(user_id: params[:student_id])
      end
    end
  end
end
