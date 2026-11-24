module Api
  module V1
    class FeatureSettingsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def show
        render json: payload
      end

      def changes
        scope = FeatureSwitchChange.includes(:actor, :cohort).order(created_at: :desc, id: :desc)
        scope = scope.where(cohort_id: cohort.id) if cohort
        rows = scope.limit(50).to_a
        render json: {
          changes: rows.map { |row| change_json(row) }
        }
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

      def change_json(row)
        before_data = row.before.is_a?(Hash) ? row.before : {}
        after_data = row.after.is_a?(Hash) ? row.after : {}
        scoped_key = row.cohort_id.present? ? "overrides" : "features"
        before_map = before_data[scoped_key].is_a?(Hash) ? before_data[scoped_key] : {}
        after_map = after_data[scoped_key].is_a?(Hash) ? after_data[scoped_key] : {}
        diff = []
        FeatureSwitches::KEYS.each do |key|
          old_val = before_map[key]
          new_val = after_map[key]
          next if old_val == new_val

          diff << { key: key, from: old_val, to: new_val }
        end
        if row.cohort_id.nil? && before_data["public_catalog_mode"] != after_data["public_catalog_mode"]
          diff << { key: "public_catalog_mode", from: before_data["public_catalog_mode"], to: after_data["public_catalog_mode"] }
        end
        before_review = row.cohort_id.present? ? before_data["review_response_time_override"] : before_data["review_response_time"]
        after_review = row.cohort_id.present? ? after_data["review_response_time_override"] : after_data["review_response_time"]
        if before_review != after_review
          diff << { key: "review_response_time", from: before_review, to: after_review }
        end
        {
          id: row.id,
          created_at: row.created_at,
          actor: row.actor && { id: row.actor.id, full_name: row.actor.full_name, email: row.actor.email },
          cohort: row.cohort && { id: row.cohort.id, name: row.cohort.name },
          diff: diff
        }
      end
    end
  end
end
