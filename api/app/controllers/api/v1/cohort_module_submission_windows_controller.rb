module Api
  module V1
    class CohortModuleSubmissionWindowsController < ApplicationController
      class InvalidSubmissionWindow < StandardError; end

      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_cohort
      before_action :set_module

      # PATCH /api/v1/cohorts/:cohort_id/modules/:module_id/submission_windows
      def update
        raw_windows = params[:submission_windows] || params[:windows] || []
        unless raw_windows.is_a?(Array)
          render json: { errors: [ "submission_windows must be an array" ] }, status: :unprocessable_entity
          return
        end

        ActiveRecord::Base.transaction do
          raw_windows.each do |raw_window|
            item = window_param_to_hash(raw_window)
            week_number = item[:week_number].to_i
            unless week_number.between?(1, @curriculum_module.week_count)
              raise InvalidSubmissionWindow,
                "Week number must be between 1 and #{@curriculum_module.week_count}"
            end

            close_at = parse_close_at(item[:submissions_close_at])

            window = @cohort.cohort_module_submission_windows.find_by(
              module_id: @curriculum_module.id,
              week_number: week_number
            )

            if close_at.blank?
              window&.destroy!
            else
              window ||= @cohort.cohort_module_submission_windows.create_or_find_by!(
                curriculum_module: @curriculum_module,
                week_number: week_number
              ) { |new_window| new_window.created_by = current_user }
              window.submissions_close_at = close_at
              window.updated_by = current_user
              window.save!
            end
          end
        end

        @cohort.cohort_module_submission_windows.reload

        render json: {
          submission_windows: module_submission_windows_json(@cohort, @curriculum_module)
        }
      rescue InvalidSubmissionWindow => e
        render json: { errors: [ e.message ] }, status: :unprocessable_entity
      rescue ActiveRecord::RecordInvalid => e
        render json: { errors: e.record.errors.full_messages }, status: :unprocessable_entity
      rescue ActiveRecord::RecordNotUnique
        render json: {
          errors: [ "Submission windows changed concurrently. Reload and try again." ]
        }, status: :conflict
      end

      private

      def set_cohort
        @cohort = Cohort.includes(:cohort_module_schedules, :cohort_module_submission_windows).find(params[:cohort_id])
      end

      def set_module
        @curriculum_module = @cohort.curriculum.modules.includes(:lessons).find(params[:module_id])
      end

      def window_param_to_hash(raw_window)
        if raw_window.is_a?(ActionController::Parameters)
          raw_window.permit(:week_number, :submissions_close_at).to_h.symbolize_keys
        elsif raw_window.is_a?(Hash)
          raw_window.symbolize_keys
        else
          {}
        end
      end

      def parse_close_at(raw_value)
        return nil if raw_value.blank?

        raw = raw_value.to_s.strip
        unless Iso8601TimeInput.explicit_offset?(raw)
          raise InvalidSubmissionWindow,
            "Submission close time must include a UTC offset (for example, Z or +10:00)"
        end

        Time.iso8601(raw)
      rescue ArgumentError, TypeError
        raise InvalidSubmissionWindow, "Submission close time is invalid"
      end

      def module_submission_windows_json(cohort, curriculum_module)
        module_start_date = curriculum_module.start_date_for(cohort)
        (1..curriculum_module.week_count).map do |week_number|
          SubmissionWindowStatus.for_week(
            cohort: cohort,
            curriculum_module: curriculum_module,
            week_number: week_number,
            module_start_date: module_start_date
          )
        end
      end
    end
  end
end
