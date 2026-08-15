module Api
  module V1
    class HelpRequestsController < ApplicationController
      before_action :authenticate_user!
      before_action :set_help_request, only: [ :show, :update ]

      def index
        scope = current_user.staff? ? HelpRequest.all : current_user.help_requests
        scope = scope.where(cohort_id: params[:cohort_id]) if params[:cohort_id].present?
        scope = scope.where(student_id: params[:student_id]) if current_user.staff? && params[:student_id].present?
        scope = scope.where(status: params[:status]) if HelpRequest.statuses.key?(params[:status])
        scope = scope.where(context_type: params[:context_type]) if HelpRequest.context_types.key?(params[:context_type])
        requests = scope.includes(:cohort, :student, :owner).recent_first.limit(100)

        render json: {
          help_requests: requests.map { |request| HelpRequestSerializer.as_json(request, include_student: current_user.staff?) }
        }
      end

      def create
        unless current_user.student?
          render_forbidden("Only students can ask for contextual help")
          return
        end

        context = HelpRequestContext.resolve!(
          student: current_user,
          cohort_id: help_request_params[:cohort_id],
          context_type: help_request_params[:context_type],
          context_id: help_request_params[:context_id],
          context_source: help_request_params[:context_source]
        )
        request = current_user.help_requests.create!(
          cohort: context.cohort,
          context_type: context.context_type,
          context_source: context.context_source,
          context_id: context.context_id,
          context_label: context.label,
          context_path: context.path,
          category: help_request_params[:category],
          urgency: help_request_params[:urgency].presence || "normal",
          message: help_request_params[:message].to_s.strip
        )
        NotificationDeliveryService.help_request_created(request)

        render json: { help_request: HelpRequestSerializer.as_json(request), created: true }, status: :created
      rescue HelpRequestContext::InvalidContext => error
        render json: { error: error.message }, status: :forbidden
      rescue ActiveRecord::RecordNotUnique
        render_existing_active_request
      rescue ActiveRecord::RecordInvalid => error
        if duplicate_context?(error.record)
          render_existing_active_request
        else
          render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
        end
      end

      def show
        render json: {
          help_request: HelpRequestSerializer.as_json(@help_request, include_student: current_user.staff?)
        }
      end

      def update
        if current_user.staff?
          update_as_staff
        else
          update_as_student
        end
      end

      private

      def set_help_request
        @help_request = if current_user.staff?
          HelpRequest.find(params[:id])
        else
          current_user.help_requests.find(params[:id])
        end
      end

      def update_as_staff
        if @help_request.status_resolved? || @help_request.status_canceled?
          render json: { error: "Resolved or canceled help requests cannot be changed" }, status: :unprocessable_entity
          return
        end

        case update_params[:status]
        when "acknowledged"
          changed = @help_request.acknowledge!(current_user)
          NotificationDeliveryService.help_request_changed(@help_request) if changed
        when "resolved"
          if update_params[:staff_response].to_s.strip.blank?
            render json: { error: "Add a response before resolving this help request" }, status: :unprocessable_entity
            return
          end

          changed = @help_request.resolve!(current_user, response: update_params[:staff_response])
          NotificationDeliveryService.help_request_changed(@help_request) if changed
        else
          render json: { error: "Staff can acknowledge or resolve a help request" }, status: :unprocessable_entity
          return
        end

        render json: { help_request: HelpRequestSerializer.as_json(@help_request.reload, include_student: true), status_changed: changed }
      end

      def update_as_student
        unless update_params[:status] == "canceled"
          render json: { error: "Students can only cancel an open help request" }, status: :unprocessable_entity
          return
        end
        unless @help_request.status_open? || @help_request.status_acknowledged?
          render json: { error: "Only active help requests can be canceled" }, status: :unprocessable_entity
          return
        end

        changed = @help_request.cancel!
        NotificationDeliveryService.help_request_canceled(@help_request) if changed
        render json: { help_request: HelpRequestSerializer.as_json(@help_request.reload), status_changed: changed }
      end

      def help_request_params
        params.require(:help_request).permit(:cohort_id, :context_type, :context_source, :context_id, :category, :urgency, :message)
      end

      def update_params
        params.require(:help_request).permit(:status, :staff_response)
      end

      def duplicate_context?(record)
        record.is_a?(HelpRequest) && record.errors.details.values.flatten.any? { |detail| detail[:error] == :taken }
      end

      def render_existing_active_request
        request = current_user.help_requests.active_queue.find_by(
          cohort_id: help_request_params[:cohort_id],
          context_type: help_request_params[:context_type],
          context_source: help_request_params[:context_source].presence || "primary",
          context_id: help_request_params[:context_id]
        )
        unless request
          render json: { error: "A help request is already active for this context" }, status: :conflict
          return
        end

        render json: { help_request: HelpRequestSerializer.as_json(request), created: false }, status: :ok
      end
    end
  end
end
