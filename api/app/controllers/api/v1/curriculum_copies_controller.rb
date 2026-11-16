module Api
  module V1
    # "Make a copy for this cohort" (CurriculumCopyForCohort). Admins, and
    # instructors whose editing access covers the cohort while other cohorts
    # share its curriculum. GET is the dry run the confirmation shows.
    class CurriculumCopiesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!
      before_action :set_cohort

      # GET /api/v1/cohorts/:cohort_id/curriculum_copy?source_curriculum_id=
      def show
        preview = service.preview
        not_allowed = preview[:blockers].find { |blocker| blocker[:code] == "not_allowed" }
        return render_forbidden(not_allowed[:message], code: "not_allowed") if not_allowed

        render json: { curriculum_copy_preview: preview }
      end

      # POST /api/v1/cohorts/:cohort_id/curriculum_copy
      def create
        result = service.copy!
        render json: { curriculum_copy: copy_json(result) }, status: result.already_copied ? :ok : :created
      rescue CurriculumCopyForCohort::Blocked => error
        return render_forbidden(error.message, code: error.code) if error.code == "not_allowed"
        # Waited too long on someone else's save (lock_timeout) or ran too
        # long: everything rolled back, so the same request can be repeated.
        return render json: { error: error.message, code: error.code }, status: :conflict if error.code == "busy"
        # The cohort moved off this curriculum (another copy, or a curriculum
        # change) after the page loaded: reload, like any other moved content.
        return render json: { error: error.message, code: "content_moved" }, status: :conflict if error.code == "source_changed"

        render json: { error: error.message, code: error.code }, status: :unprocessable_entity
      rescue CurriculumCopyForCohort::VerificationFailed => error
        Rails.logger.error("[CurriculumCopy] verification_failed cohort_id=#{@cohort.id} #{error.message}")
        render json: { error: error.message, code: "verification_failed" }, status: :unprocessable_entity
      rescue ActiveRecord::RecordInvalid => error
        render json: { error: error.record.errors.full_messages.to_sentence, code: "invalid" }, status: :unprocessable_entity
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
        require_cohort_access!(@cohort)
      end

      def service
        CurriculumCopyForCohort.new(cohort: @cohort, user: current_user, source_curriculum_id: params[:source_curriculum_id])
      end

      def copy_json(result)
        copy = result.copy
        {
          id: copy.id,
          cohort: { id: copy.cohort.id, name: copy.cohort.name },
          source_curriculum: copy.source_curriculum && { id: copy.source_curriculum.id, name: copy.source_curriculum.name },
          copy_curriculum: { id: copy.copy_curriculum.id, name: copy.copy_curriculum.name },
          created_by: copy.created_by && { id: copy.created_by.id, full_name: copy.created_by.full_name },
          created_at: copy.created_at.iso8601,
          already_copied: result.already_copied,
          counts: result.counts,
          lesson_ids: result.lesson_ids
        }
      end
    end
  end
end
