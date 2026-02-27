module Api
  module V1
    class ProfileController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/profile
      def show
        enrollments = current_user.enrollments.includes(cohort: :curriculum)

        render json: {
          user: {
            id: current_user.id,
            email: current_user.email,
            first_name: current_user.first_name,
            last_name: current_user.last_name,
            full_name: current_user.full_name,
            role: current_user.role,
            github_username: current_user.github_username,
            avatar_url: current_user.avatar_url
          },
          enrollments: enrollments.map { |e|
            {
              id: e.id,
              cohort_name: e.cohort.name,
              curriculum_name: e.cohort.curriculum.name,
              status: e.status,
              enrolled_at: e.enrolled_at
            }
          }
        }
      end

      # PATCH /api/v1/profile
      def update
        if current_user.update(profile_params)
          render json: {
            user: {
              id: current_user.id,
              email: current_user.email,
              first_name: current_user.first_name,
              last_name: current_user.last_name,
              full_name: current_user.full_name,
              github_username: current_user.github_username,
              avatar_url: current_user.avatar_url
            }
          }
        else
          render json: { errors: current_user.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def profile_params
        params.permit(:github_username, :avatar_url)
      end
    end
  end
end
