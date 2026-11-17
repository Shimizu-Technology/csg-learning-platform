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

        visible_cohorts = StaffCohortScope.new(current_user).visible_cohorts
        visible_cohorts = visible_cohorts.where(id: cohort.id) if cohort
        cohort_ids = visible_cohorts.select(:id)
        # Help on one lesson or one module (L-3.2): the "open help" counts on content pages link here.
        # Inside one cohort, an id from before "Make a copy for this cohort" names the copy's
        # (MovedContent), as Grading does, so a saved link keeps its filter.
        lesson_id = cohort ? moved_content_id("Lesson", params[:lesson_id], cohort_id: cohort.id) : params[:lesson_id]
        module_id = cohort ? moved_content_id("CurriculumModule", params[:module_id], cohort_id: cohort.id) : params[:module_id]
        render json: { support_queue: SupportQueueProjection.new(cohort_ids: cohort_ids, lesson_id: lesson_id, module_id: module_id, student_id: params[:student_id].presence).call }
      end
    end
  end
end
