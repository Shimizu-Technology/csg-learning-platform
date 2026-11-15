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
            avatar_url: current_user.avatar_url,
            handle: current_user.handle
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
              avatar_url: current_user.avatar_url,
              handle: current_user.handle
            }
          }
        else
          render json: { errors: current_user.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotUnique
        # Two people saved the same handle at once; the unique index kept one.
        render json: { errors: [ "Handle has already been taken" ] }, status: :unprocessable_entity
      end

      private

      def profile_params
        params.permit(:github_username, :avatar_url, :handle)
      end
    end
  end
end
