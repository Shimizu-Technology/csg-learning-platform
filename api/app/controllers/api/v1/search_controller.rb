module Api
  module V1
    class SearchController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

      def index
        response.headers["Cache-Control"] = "private, no-store"
        render json: RecordSearch.new(viewer: current_user, query: params[:q]).call
      end
    end
  end
end
