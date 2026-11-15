module Api
  module V1
    class FeatureSettingsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!

      def show
        render json: payload
      end

      def update
        features = params.require(:features).to_unsafe_h
        FeatureSwitches.validate!(features)
        record = cohort || SchoolSetting.current
        record.with_lock do
          before = payload
          if cohort
            cohort.update!(settings: (cohort.settings || {}).merge("features" => features.compact))
          else
            mode = params[:public_catalog_mode] || record.public_catalog_mode
            record.update!(features: features.compact, public_catalog_mode: mode)
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
        { features: FeatureSwitches.for(cohort: cohort), defaults: FeatureSwitches.for,
          overrides: cohort&.settings&.dig("features") || {}, public_catalog_mode: school.public_catalog_mode }
      end
    end
  end
end
