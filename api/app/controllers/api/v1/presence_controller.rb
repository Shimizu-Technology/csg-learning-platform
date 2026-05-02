module Api
  module V1
    class PresenceController < ApplicationController
      before_action :authenticate_user!

      # POST /api/v1/presence — lightweight heartbeat for "online/recently active" UI.
      def create
        current_user.update_column(:last_seen_at, Time.current)
        render json: { last_seen_at: current_user.last_seen_at }
      end
    end
  end
end
