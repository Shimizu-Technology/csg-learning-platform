module Api
  module V1
    # A learner's personal start and chosen pace (W9.1). The learner reads and
    # chooses their own pace; staff who teach the cohort read it, set a pace
    # for the learner, and set the learner's personal start date. See
    # LearnerPace for the rules.
    class PersonalPacesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_enrollment

      def show
        render json: pace_json
      end

      def update
        if params.key?(:starts_on)
          return render_forbidden("Only staff can set a start date") unless current_user.staff?
          return unless update_start_date
        end
        if params.key?(:weeks)
          LearnerPace.new(@enrollment).choose!(weeks: params[:weeks], actor: current_user, request_started_at: @learning_request_started_at)
        end
        render json: pace_json
      rescue LearnerPace::Refused => error
        render json: { error: error.message }, status: error.status
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      rescue ActiveRecord::StaleObjectError, ActiveRecord::RecordNotUnique
        render_stale_resource("Pace")
      end

      private

      def set_enrollment
        @enrollment = Enrollment.includes(:user, cohort: :curriculum).find(params[:enrollment_id])
        if current_user.staff?
          require_cohort_access!(@enrollment.cohort, teacher: true)
        elsif @enrollment.user_id != current_user.id || !Enrollment.with_read_access.exists?(id: @enrollment.id)
          render_forbidden("Cannot access this enrollment")
        end
      end

      # Staff move one learner's start (a late joiner, or a restart). A pace
      # plan follows the new start; a staff plan keeps its own dates.
      def update_start_date
        raw = params[:starts_on].presence
        starts_on = raw && Date.iso8601(raw.to_s)
        unless @enrollment.cohort.personal_pace?
          render json: { error: "Turn on learner-chosen pace for this course to set a personal start." }, status: :unprocessable_entity
          return false
        end
        Enrollment.capture_missing_paused_libraries!(Enrollment.where(id: @enrollment.id))
        with_learning_write_guard(@enrollment) do
          @enrollment.update!(starts_on: starts_on)
        end
        plan = @enrollment.reload.learning_plan
        if plan&.active? && plan.learner_pace? && plan.pace_weeks && LearnerPace.new(@enrollment).available?
          LearnerPace.new(@enrollment).choose!(weeks: plan.pace_weeks, actor: current_user, request_started_at: @learning_request_started_at)
        end
        true
      rescue Date::Error
        render json: { error: "Start date is invalid" }, status: :unprocessable_entity
        false
      end

      def pace_json
        @enrollment.reload
        cohort = @enrollment.cohort
        return { personal_pace: nil } unless cohort.personal_pace?

        features = FeatureSwitches.for(cohort: cohort)
        progress = LearnerProgress.new(@enrollment)
        { personal_pace: LearnerPace.new(@enrollment, features: features).as_json(progress) }
      end
    end
  end
end
