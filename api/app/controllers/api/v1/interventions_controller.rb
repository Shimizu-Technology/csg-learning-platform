module Api
  module V1
    class InterventionsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_intervention, only: [ :show, :update ]

      def index
        scope = Intervention.includes(enrollment: [ :user, :cohort ], owner: [], created_by: [], recovery_plan: [])
          .recent_first
        scope = scope.where(enrollment_id: params[:enrollment_id]) if params[:enrollment_id].present?
        scope = scope.where(owner_id: params[:owner_id]) if params[:owner_id].present?
        scope = scope.where(status: params[:status]) if params[:status].present?
        scope = scope.due if ActiveModel::Type::Boolean.new.cast(params[:due])

        render json: { interventions: scope.limit(200).map { |intervention| InterventionSerializer.as_json(intervention) } }
      end

      def show
        render json: { intervention: InterventionSerializer.as_json(@intervention, include_notes: true) }
      end

      def create
        enrollment = Enrollment.includes(:user, :cohort).find(create_params[:enrollment_id])
        trigger_type = create_params[:trigger_type].to_s
        help_request = create_params[:help_request_id].present? ? HelpRequest.find(create_params[:help_request_id]) : nil
        existing = enrollment.interventions.active.find_by(trigger_type: trigger_type)
        if existing
          render json: { error: "An active #{trigger_type.humanize.downcase} intervention already exists", intervention: InterventionSerializer.as_json(existing) }, status: :conflict
          return
        end

        intervention = enrollment.interventions.create!(
          trigger_type: trigger_type,
          severity: create_params[:severity].presence || :normal,
          status: :open,
          owner: owner_for(create_params[:owner_id]),
          created_by: current_user,
          help_request: help_request,
          action_summary: create_params[:action_summary].to_s.strip.presence,
          next_follow_up_at: create_params[:next_follow_up_at].presence || 1.week.from_now,
          evidence_snapshot: InterventionEvidenceBuilder.new(enrollment: enrollment, trigger_type: trigger_type, help_request: help_request).call
        )
        NotificationDeliveryService.intervention_assigned(intervention) if intervention.owner != current_user

        render json: { intervention: InterventionSerializer.as_json(intervention, include_notes: true) }, status: :created
      rescue ActiveRecord::RecordNotUnique
        existing = enrollment.interventions.active.find_by!(trigger_type: trigger_type)
        render json: { error: "An active #{trigger_type.humanize.downcase} intervention already exists", intervention: InterventionSerializer.as_json(existing) }, status: :conflict
      rescue ActiveRecord::RecordInvalid, ArgumentError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      def update
        if @intervention.status_resolved? || @intervention.status_canceled?
          render json: { error: "Terminal interventions cannot be reopened" }, status: :unprocessable_entity
          return
        end

        attributes = update_params.to_h.symbolize_keys
        attributes[:owner] = owner_for(attributes.delete(:owner_id)) if attributes.key?(:owner_id)
        attributes[:action_summary] = attributes[:action_summary].to_s.strip.presence if attributes.key?(:action_summary)
        attributes[:resolution_summary] = attributes[:resolution_summary].to_s.strip.presence if attributes.key?(:resolution_summary)
        @intervention.update!(attributes)
        if @intervention.saved_change_to_owner_id?
          @intervention.notifications.where.not(user_id: @intervention.owner_id).update_all(read_at: Time.current, updated_at: Time.current)
          NotificationDeliveryService.intervention_assigned(@intervention) if @intervention.active?
        end
        close_notifications if @intervention.status_resolved? || @intervention.status_canceled?

        render json: { intervention: InterventionSerializer.as_json(@intervention.reload, include_notes: true) }
      rescue ActiveRecord::RecordInvalid, ArgumentError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      private

      def set_intervention
        @intervention = Intervention.includes(enrollment: [ :user, :cohort ], notes: :author, recovery_plan: []).find(params[:id])
      end

      def create_params
        params.require(:intervention).permit(:enrollment_id, :help_request_id, :trigger_type, :severity, :owner_id, :action_summary, :next_follow_up_at)
      end

      def update_params
        params.require(:intervention).permit(:status, :severity, :owner_id, :action_summary, :next_follow_up_at, :outcome, :resolution_summary)
      end

      def owner_for(owner_id)
        owner_id.present? ? User.find(owner_id) : current_user
      end

      def close_notifications
        @intervention.notifications.update_all(read_at: Time.current, updated_at: Time.current)
      end
    end
  end
end
