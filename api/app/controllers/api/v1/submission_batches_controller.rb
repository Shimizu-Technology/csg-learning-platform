module Api
  module V1
    # Batch review of one exercise's waiting work (SubmissionBatchReview) and
    # batch approval of the passing ones (SubmissionBatchGrade). Staff only;
    # every item is checked against the viewer's cohorts (StaffCohortScope).
    class SubmissionBatchesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!

      # GET /api/v1/submissions/batch_review
      def show
        # Only cohorts this viewer may see: one they can't and one that doesn't exist answer alike.
        cohort = StaffCohortScope.new(current_user).visible_cohorts.find_by(id: params[:cohort_id]) if params[:cohort_id].present?
        if params[:cohort_id].present? && cohort.nil?
          render json: { error: "Cohort not found" }, status: :not_found
          return
        end

        render json: SubmissionBatchReview.new(
          viewer: current_user,
          cohort: cohort,
          # Inside one cohort, ids from before "Make a copy for this cohort" name the copy's.
          module_id: cohort ? moved_content_id("CurriculumModule", params[:module_id], cohort_id: cohort.id) : params[:module_id],
          lesson_id: cohort ? moved_content_id("Lesson", params[:lesson_id], cohort_id: cohort.id) : params[:lesson_id],
          content_block_id: cohort ? moved_content_id("ContentBlock", params[:content_block_id], cohort_id: cohort.id) : params[:content_block_id]
        ).as_json
      end

      # POST /api/v1/submissions/batch_grade
      def create
        grade = params[:grade]
        # Strings only: an enum integer, "R", "A" or "C" never reaches a lock.
        unless grade.is_a?(String) && SubmissionBatchGrade::GRADES.include?(grade)
          render json: { errors: [ SubmissionBatchGrade::GRADE_INVALID ] }, status: :unprocessable_entity
          return
        end
        feedback = params[:feedback]
        unless feedback.nil? || feedback.is_a?(String)
          render json: { errors: [ "Feedback must be text." ] }, status: :unprocessable_entity
          return
        end
        items = SubmissionBatchGrade.parse_items(params[:items])

        result = SubmissionBatchGrade.new(
          viewer: current_user, grade: grade, feedback: feedback, items: items,
          request_started_at: @learning_request_started_at
        ).call

        if result[:graded].empty?
          render json: { errors: [ SubmissionBatchGrade::NONE_GRADED ], **result }, status: :unprocessable_entity
        else
          render json: result
        end
      rescue SubmissionBatchGrade::Invalid => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      end
    end
  end
end
