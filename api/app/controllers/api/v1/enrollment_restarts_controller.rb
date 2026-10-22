module Api
  module V1
    class EnrollmentRestartsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!

      def create
        enrollment = Enrollment.includes(:user, :cohort).find(params[:enrollment_id])
        confirmation = params[:confirmation].to_s.strip.downcase

        unless ActiveSupport::SecurityUtils.secure_compare(confirmation, enrollment.user.email.downcase)
          render json: { error: "Enter the student's email address to confirm the restart" }, status: :unprocessable_entity
          return
        end

        unless params.key?(:restart_version)
          render json: { error: "This learner was just restarted — refresh to see the latest state" }, status: :conflict
          return
        end

        restart = EnrollmentRestartService.new(
          enrollment: enrollment,
          performed_by: current_user,
          expected_restart_version: params[:restart_version],
          reason: params[:reason]
        ).call

        render json: {
          message: "Class progress restarted",
          restart: {
            id: restart.id,
            student_id: restart.student_id,
            cohort_id: restart.cohort_id,
            records_removed: restart.records_removed,
            created_at: restart.created_at
          },
          recovery_plan: RecoveryPlanSerializer.as_json(restart.recovery_plan)
        }, status: :created
      rescue EnrollmentRestartService::Conflict => e
        render json: { error: e.message }, status: :conflict
      end
    end
  end
end
