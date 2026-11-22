module Api
  module V1
    # GET /api/v1/grading_queue: one page of the Grading workbench's queue, with
    # its counts and filter options (GradingQueue).
    class GradingQueueController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!

      def index
        cohort = nil
        if params[:cohort_id].present?
          cohort = Cohort.find(params[:cohort_id])
          return unless require_cohort_access!(cohort, teacher: true)
        end

        render json: GradingQueue.new(
          viewer: current_user,
          cohort: cohort,
          status: params[:filter],
          # Inside one cohort, a module or lesson id from before "Make a copy for this
          # cohort" names the copy's (MovedContent), so older links keep their filter.
          module_id: cohort ? moved_content_id("CurriculumModule", params[:module_id], cohort_id: cohort.id) : params[:module_id],
          student_id: params[:student_id],
          lesson_id: cohort ? moved_content_id("Lesson", params[:lesson_id], cohort_id: cohort.id) : params[:lesson_id],
          suggestion_outcome: params[:suggestion_outcome],
          sort: params[:sort],
          page: params[:page],
          per_page: params[:per_page],
          focus_id: params[:focus_id]
        ).as_json
      end
    end
  end
end
