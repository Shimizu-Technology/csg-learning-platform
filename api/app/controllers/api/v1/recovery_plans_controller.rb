module Api
  module V1
    class RecoveryPlansController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_plan, only: [ :show, :update ]

      def index
        scope = RecoveryPlan.includes(enrollment: [ :user, :cohort ], owner: [], created_by: [], check_ins: :author).recent_first
        scope = scope.where(enrollment_id: params[:enrollment_id]) if params[:enrollment_id].present?
        scope = scope.where(status: params[:status]) if params[:status].present?
        scope = scope.due if ActiveModel::Type::Boolean.new.cast(params[:due])
        render json: { recovery_plans: scope.limit(200).map { |plan| RecoveryPlanSerializer.as_json(plan) } }
      end

      def show
        render json: { recovery_plan: RecoveryPlanSerializer.as_json(@plan, include_check_ins: true) }
      end

      def create
        enrollment = Enrollment.includes(:user, :cohort).find(create_params[:enrollment_id])
        if enrollment.recovery_plans.status_active.exists?
          render json: { error: "This enrollment already has an active recovery plan" }, status: :conflict
          return
        end

        plan = enrollment.recovery_plans.create!(
          source: create_params[:source],
          status: :active,
          owner: owner_for(create_params[:owner_id]),
          created_by: current_user,
          intervention_id: create_params[:intervention_id],
          target_pace: create_params[:target_pace].to_s.strip,
          required_scope: create_params[:required_scope].to_s.strip,
          optional_scope: create_params[:optional_scope].to_s.strip.presence,
          check_in_cadence: create_params[:check_in_cadence].presence || "weekly",
          next_check_in_at: create_params[:next_check_in_at].presence || 1.week.from_now
        )
        render json: { recovery_plan: RecoveryPlanSerializer.as_json(plan, include_check_ins: true) }, status: :created
      rescue ActiveRecord::RecordNotUnique
        plan = enrollment.recovery_plans.status_active.first!
        render json: { error: "This enrollment already has an active recovery plan", recovery_plan: RecoveryPlanSerializer.as_json(plan) }, status: :conflict
      rescue ActiveRecord::RecordInvalid, ArgumentError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      def update
        if @plan.status_completed? || @plan.status_canceled?
          render json: { error: "Terminal recovery plans cannot be reopened" }, status: :unprocessable_entity
          return
        end

        attributes = update_params.to_h.symbolize_keys
        attributes[:owner] = owner_for(attributes.delete(:owner_id)) if attributes.key?(:owner_id)
        @plan.update!(attributes)
        render json: { recovery_plan: RecoveryPlanSerializer.as_json(@plan.reload, include_check_ins: true) }
      rescue ActiveRecord::RecordInvalid, ArgumentError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      private

      def set_plan
        @plan = RecoveryPlan.includes(enrollment: [ :user, :cohort ], check_ins: :author).find(params[:id])
      end

      def create_params
        params.require(:recovery_plan).permit(:enrollment_id, :intervention_id, :source, :owner_id, :target_pace, :required_scope, :optional_scope, :check_in_cadence, :next_check_in_at)
      end

      def update_params
        params.require(:recovery_plan).permit(:status, :owner_id, :target_pace, :required_scope, :optional_scope, :check_in_cadence, :next_check_in_at, :outcome)
      end

      def owner_for(owner_id)
        owner_id.present? ? User.find(owner_id) : current_user
      end
    end
  end
end
