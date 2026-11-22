module Api
  module V1
    # A learner's choice about optional reminders (W9.3). Access-ending notices
    # are essential and are sent either way.
    class NudgePreferencesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def show
        render json: payload
      end

      def update
        raw = params[:learner_nudges_enabled]
        return render json: { error: "learner_nudges_enabled must be true or false" }, status: :unprocessable_entity unless [ true, false ].include?(raw)

        current_user.update!(learner_nudges_enabled: raw)
        render json: payload
      end

      private

      def payload
        { learner_nudges_enabled: current_user.learner_nudges_enabled? }
      end
    end
  end
end
