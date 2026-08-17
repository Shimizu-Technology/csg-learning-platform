module Api
  module V1
    class CommunityPoliciesController < ApplicationController
      before_action :authenticate_user!

      def show
        render json: { community_policy: CommunityPolicy.as_json(current_user) }
      end

      def accept
        unless params[:accepted] == true && params[:version] == CommunityPolicy::VERSION
          render json: { error: "Accept the current community terms to continue" }, status: :unprocessable_entity
          return
        end

        current_user.update!(
          community_terms_version: CommunityPolicy::VERSION,
          community_terms_accepted_at: Time.current
        )
        render json: { community_policy: CommunityPolicy.as_json(current_user) }
      end
    end
  end
end
