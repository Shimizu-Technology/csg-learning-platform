module Api
  module V1
    class CableTokensController < ApplicationController
      before_action :authenticate_user!

      # POST /api/v1/cable_token
      def create
        render json: {
          token: CableToken.issue_for(current_user),
          expires_in: CableToken::EXPIRES_IN.to_i
        }
      end
    end
  end
end
