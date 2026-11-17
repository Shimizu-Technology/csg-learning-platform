module Api
  module V1
    class FeatureSettingsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def show
        render json: payload
      end

      def update
        features = params.fetch(:features, ActionController::Parameters.new).to_unsafe_h.slice(*FeatureSwitches::KEYS)
        FeatureSwitches.validate!(features)
        record = cohort || SchoolSetting.current
        record.with_lock do
          before = payload
          record.review_response_time = params[:review_response_time].presence if params.key?(:review_response_time)
          if cohort
            cohort.update!(settings: params.key?(:features) ? (cohort.settings || {}).merge("features" => features.compact) : cohort.settings)
          else
            mode = params[:public_catalog_mode] || record.public_catalog_mode
            record.update!(features: params.key?(:features) ? features.compact : record.features, public_catalog_mode: mode)
          end
          FeatureSwitchChange.create!(actor: current_user, cohort: cohort, before: before, after: payload)
        end
        render json: payload
      rescue ArgumentError, ActiveRecord::RecordInvalid => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      private

      def cohort
        @cohort ||= Cohort.find(params[:cohort_id]) if params[:cohort_id].present?
      end

      def payload
        school = SchoolSetting.current
        { review_response_time: cohort ? cohort.effective_review_response_time : school.review_response_time,
          review_response_time_override: cohort&.review_response_time,
          review_response_time_default: school.review_response_time,
          features: FeatureSwitches.for(cohort: cohort), defaults: FeatureSwitches.for,
          overrides: (cohort&.settings&.dig("features") || {}).slice(*FeatureSwitches::KEYS),
          cohort: cohort && { id: cohort.id, name: cohort.name }, public_catalog_mode: school.public_catalog_mode }
      end
    end
  end
end
