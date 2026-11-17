module Api
  module V1
    class WebHandoffsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def create
        destination = params[:destination].to_s
        destination_path = destination.split(/[?#]/, 2).first
        unless WebHandoffDestination.supported?(destination)
          render json: { error: "Unsupported web destination" }, status: :unprocessable_entity
          return
        end
        if WebHandoffDestination::POLICY.fetch("admin_only_paths").include?(destination_path) && !current_user.admin?
          render_forbidden("Admin access is required for this destination")
          return
        end
        if destination_path.start_with?("/admin") && !current_user.staff?
          render_forbidden("Staff access is required for this destination")
          return
        end

        redirect_url = "#{FrontendUrlResolver.resolve.delete_suffix('/')}#{destination}"
        result = ClerkWebHandoffService.new.create(user: current_user, redirect_url: redirect_url)
        if result[:success]
          render json: { url: result[:url] }
        else
          render json: { error: result[:error] }, status: :service_unavailable
        end
      end
    end
  end
end
