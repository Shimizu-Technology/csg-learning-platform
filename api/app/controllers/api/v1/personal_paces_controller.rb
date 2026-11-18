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

      # A start and a pace sent together commit together: a refused pace
      # leaves the start as it was.
      def update
        if params.key?(:starts_on) && !current_user.staff?
          return render_forbidden("Only staff can set a start date")
        end
        Enrollment.capture_missing_paused_libraries!(Enrollment.where(id: @enrollment.id)) if params.key?(:starts_on)
        with_learning_write_guard(@enrollment) do
          update_start_date! if params.key?(:starts_on)
          if params.key?(:weeks)
            LearnerPace.new(@enrollment).choose!(weeks: params[:weeks], actor: current_user, request_started_at: @learning_request_started_at)
          end
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
      # plan follows the new start; a staff plan keeps its own dates. A paused
      # or ended learner's start still moves (it governs what they can read),
      # with no re-plan. Runs inside the update's lock and transaction.
      def update_start_date!
        raw = params[:starts_on].presence
        starts_on = begin
          raw && Date.iso8601(raw.to_s)
        rescue Date::Error
          raise LearnerPace::Refused, "Start date is invalid"
        end
        raise LearnerPace::Refused, "Turn on learner-chosen pace for this course to set a personal start." unless @enrollment.cohort.personal_pace?

        @enrollment.update!(starts_on: starts_on)
        LearnerPace.new(@enrollment).regenerate!(actor: current_user)
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
