module Api
  module V1
    class UsersController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [:index, :show]
      before_action :require_admin!, only: [:update]
      before_action :set_user, only: [:show, :update]

      # GET /api/v1/users
      def index
        users = User.all.order(:last_name, :first_name)

        if params[:role].present?
          users = users.where(role: params[:role])
        end

        render json: {
          users: users.map { |u| user_json(u) }
        }
      end

      # GET /api/v1/users/:id
      def show
        enrollments = @user.enrollments.includes(cohort: :curriculum)
        render json: {
          user: user_json(@user),
          enrollments: enrollments.map { |e|
            {
              id: e.id,
              cohort_id: e.cohort_id,
              cohort_name: e.cohort.name,
              status: e.status,
              enrolled_at: e.enrolled_at,
              completed_at: e.completed_at
            }
          }
        }
      end

      # PATCH /api/v1/users/:id
      def update
        if @user.update(user_params)
          render json: { user: user_json(@user) }
        else
          render json: { errors: @user.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_user
        @user = User.find(params[:id])
      end

      def user_params
        params.permit(:first_name, :last_name, :role, :github_username, :avatar_url)
      end

      def user_json(user)
        {
          id: user.id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          full_name: user.full_name,
          role: user.role,
          github_username: user.github_username,
          avatar_url: user.avatar_url,
          last_sign_in_at: user.last_sign_in_at,
          created_at: user.created_at
        }
      end
    end
  end
end
