module Api
  module V1
    # Reminders sent to one learner (W9.3), for the staff student workspace.
    class LearnerNudgesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      LIMIT = 100

      rescue_from ActiveRecord::RecordNotFound do
        render json: { error: "Not found" }, status: :not_found
      end

      def index
        raise ActiveRecord::RecordNotFound unless current_user.staff?

        enrollment = Enrollment.where(cohort_id: StaffCohortScope.new(current_user).visible_cohorts.select(:id)).includes(:cohort, :user).find(params[:enrollment_id])
        nudges = enrollment.learner_nudges.order(created_at: :desc, id: :desc).limit(LIMIT).to_a
        notifications = Notification.where(notifiable_type: "LearnerNudge", notifiable_id: nudges.map(&:id), user_id: enrollment.user_id).index_by(&:notifiable_id)
        render json: {
          enabled: LearnerNudges.enabled_for?(enrollment.cohort),
          learner_opted_out: !enrollment.user.learner_nudges_enabled?,
          nudges: nudges.map { |nudge| nudge.staff_json(notifications[nudge.id]) }
        }
      end
    end
  end
end
