module Api
  module V1
    class RecoveryPlanCheckInsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!

      def create
        plan = RecoveryPlan.find(params[:recovery_plan_id])
        unless plan.status_active?
          render json: { error: "Check-ins can only be added to an active recovery plan" }, status: :unprocessable_entity
          return
        end
        check_in = nil
        RecoveryPlan.transaction do
          check_in = plan.check_ins.create!(
            author: current_user,
            body: check_in_params[:body].to_s.strip,
            next_check_in_at: check_in_params[:next_check_in_at]
          )
          plan.update!(
            last_check_in_at: Time.current,
            next_check_in_at: check_in.next_check_in_at.presence || cadence_from_now(plan.check_in_cadence)
          )
        end
        render json: { check_in: RecoveryPlanSerializer.check_in_json(check_in), recovery_plan: RecoveryPlanSerializer.as_json(plan.reload, include_check_ins: true) }, status: :created
      rescue ActiveRecord::RecordInvalid, ArgumentError => e
        render json: { error: e.message }, status: :unprocessable_entity
      end

      private

      def check_in_params
        params.require(:check_in).permit(:body, :next_check_in_at)
      end

      def cadence_from_now(cadence)
        cadence == "biweekly" ? 2.weeks.from_now : 1.week.from_now
      end
    end
  end
end
