module Api
  module V1
    class PresenceController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      # POST /api/v1/presence — lightweight heartbeat for "online/recently active" UI.
      def create
        # The heartbeat always records "now"; skip it only when authentication
        # already wrote last_seen_at for this request.
        current_user.update_column(:last_seen_at, Time.current) unless @last_seen_recorded
        PresenceBroadcastService.user_seen(current_user)
        render json: { last_seen_at: current_user.last_seen_at }
      end
    end
  end
end
