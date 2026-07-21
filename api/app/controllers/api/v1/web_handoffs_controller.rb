module Api
  module V1
    class WebHandoffsController < ApplicationController
      ALLOWED_DESTINATIONS = %r{\A/(?:lessons|modules)/\d+\z}

      before_action :authenticate_user!

      def create
        destination = params[:destination].to_s
        unless ALLOWED_DESTINATIONS.match?(destination)
          render json: { error: "Unsupported web destination" }, status: :unprocessable_entity
          return
        end

        redirect_url = "#{FrontendUrlResolver.resolve.delete_suffix('/')}#{destination}"
        result = ClerkWebHandoffService.new.create(user_id: current_user.clerk_id, redirect_url: redirect_url)
        if result[:success]
          render json: { url: result[:url] }
        else
          render json: { error: result[:error] }, status: :service_unavailable
        end
      end
    end
  end
end
