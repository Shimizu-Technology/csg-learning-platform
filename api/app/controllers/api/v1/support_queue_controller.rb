module Api
  module V1
    class SupportQueueController < ApplicationController
      before_action :authenticate_user!

      def show
        unless current_user.staff?
          render_forbidden("Staff access required")
          return
        end

        render json: { support_queue: SupportQueueProjection.new.call }
      end
    end
  end
end
