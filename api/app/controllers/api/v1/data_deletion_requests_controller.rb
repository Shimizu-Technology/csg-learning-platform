module Api
  module V1
    class DataDeletionRequestsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :update ]

      def index
        requests = DataDeletionRequest.includes(:user, :resolved_by).recent_first.limit(200)
        render json: { data_deletion_requests: requests.map { |request| request_json(request) } }
      end

      def create
        request = current_user.data_deletion_requests.where(status: %i[pending processing]).first
        request ||= current_user.data_deletion_requests.create!
        render json: { data_deletion_request: request_json(request) }, status: :created
      rescue ActiveRecord::RecordNotUnique
        # Keep repeated taps/retries idempotent even when two requests race.
        request = current_user.data_deletion_requests.where(status: %i[pending processing]).first!
        render json: { data_deletion_request: request_json(request) }, status: :created
      end

      def update
        request = DataDeletionRequest.find(params[:id])
        status = update_params[:status].to_s
        unless %w[processing completed declined].include?(status)
          render json: { errors: [ "Status must be processing, completed, or declined" ] }, status: :unprocessable_entity
          return
        end

        attributes = {
          status: status,
          resolved_by: current_user,
          resolved_at: %w[completed declined].include?(status) ? Time.current : nil
        }
        attributes[:retention_note] = update_params[:retention_note] if update_params.key?(:retention_note)
        request.update!(attributes)
        render json: { data_deletion_request: request_json(request) }
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      private

      def update_params
        params.require(:data_deletion_request).permit(:status, :retention_note)
      end

      def request_json(request)
        {
          id: request.id,
          status: request.status,
          retention_note: request.retention_note,
          created_at: request.created_at,
          resolved_at: request.resolved_at,
          user: { id: request.user.id, full_name: request.user.full_name, email: request.user.email },
          resolved_by: request.resolved_by && { id: request.resolved_by.id, full_name: request.resolved_by.full_name }
        }
      end
    end
  end
end
