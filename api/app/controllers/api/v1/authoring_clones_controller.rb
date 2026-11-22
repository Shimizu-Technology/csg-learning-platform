module Api
  module V1
    class AuthoringClonesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def create
        result = AuthoringCloneService.new(user: current_user, kind: params[:kind], source_id: params[:id],
          attributes: params.permit(:name, :client_request_id, :curriculum_id, :position, :start_date, :clone_curriculum)).call
        record = result.record
        json = { id: record.id, name: record.name }
        json[:curriculum_id] = record.curriculum_id unless record.is_a?(Curriculum)
        json[:status] = record.status unless record.is_a?(CurriculumModule)
        if record.is_a?(Cohort)
          json.merge!(start_date: record.start_date, end_date: record.end_date, enrolled_count: 0,
            feature_overrides: record.settings.fetch("features", {}), features: FeatureSwitches.for_client(FeatureSwitches.for(cohort: record)))
        end
        render json: { clone: json, replayed: result.replayed }, status: result.replayed ? :ok : :created
      rescue AuthoringCloneService::Invalid => error
        render json: { errors: [ error.message ] }, status: :unprocessable_entity
      rescue AuthoringCloneService::Conflict => error
        render json: { errors: [ error.message ] }, status: :conflict
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end
    end
  end
end
