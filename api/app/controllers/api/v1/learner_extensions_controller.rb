module Api
  module V1
    class LearnerExtensionsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_enrollment
      rescue_from ActiveRecord::RecordNotFound do
        render json: { error: "Not found" }, status: :not_found
      end

      def index
        render json: payload
      end

      def create
        change(@enrollment.learner_extensions.new)
      end

      def update
        change(@enrollment.learner_extensions.find(params[:id]))
      end

      def destroy
        change(@enrollment.learner_extensions.find(params[:id]), removing: true)
      end

      private

      def set_enrollment
        raise ActiveRecord::RecordNotFound unless current_user.staff?

        @enrollment = Enrollment.where(cohort_id: StaffCohortScope.new(current_user).visible_cohorts.select(:id)).find(params[:enrollment_id])
      end

      def change(extension, removing: false)
        return render json: { errors: [ "A reason is required for every change" ] }, status: :unprocessable_entity unless params[:reason].is_a?(String) && params[:reason].present?

        if !removing && params.key?(:submissions_close_at)
          raw = params[:submissions_close_at]
          unless raw.is_a?(String) && raw.match?(/(?:Z|[+-]\d{2}:\d{2})\z/) && (DateTime.iso8601(raw) rescue nil)
            return render json: { errors: [ "Deadline must be an ISO timestamp with a UTC offset" ] }, status: :unprocessable_entity
          end
        end
        @enrollment.with_lock do
          extension.lock! if extension.persisted?
          raise ActiveRecord::RecordNotFound if extension.removed_at
          extension.assign_attributes(params.permit(:scope, :lesson_id, :module_id, :week_number, :submissions_close_at, :reason)) unless removing
          extension.reason = params[:reason] if removing
          extension.record_change!(actor: current_user, removing: removing)
        end
        render json: payload
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      def payload
        { personal_pace: @enrollment.cohort.personal_pace?, extensions: @enrollment.learner_extensions.includes(:granted_by).order(:id).map(&:staff_json) }
      end
    end
  end
end
