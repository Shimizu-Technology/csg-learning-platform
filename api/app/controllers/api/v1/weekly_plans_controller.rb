module Api
  module V1
    class WeeklyPlansController < ApplicationController
      before_action :authenticate_user!

      def show
        unless current_user.student?
          render_forbidden("Weekly plans are available to students")
          return
        end

        render json: { weekly_plan: WeeklyPlanProjection.new(current_user).call }
      end
    end
  end
end
