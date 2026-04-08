module Api
  module V1
    class UsersController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :show ]
      before_action :require_admin!, only: [ :create, :update, :destroy, :resend_invite ]
      before_action :set_user, only: [ :show, :update, :destroy, :resend_invite ]

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

      # POST /api/v1/users
      def create
        email = user_create_params[:email].to_s.strip.downcase
        if email.blank?
          return render json: { errors: [ "Email is required" ] }, status: :unprocessable_entity
        end

        user = User.find_or_initialize_by(email: email)
        is_new = user.new_record?
        user.clerk_id = "pending_#{SecureRandom.uuid}" if user.clerk_id.blank?
        if is_new
          requested_role = params[:role].to_s.strip.downcase
          user.role = User.roles.key?(requested_role) ? requested_role : :student
        end
        user.github_username = user_create_params[:github_username] if user_create_params[:github_username].present?

        if user.save
          skip = ActiveModel::Type::Boolean.new.cast(params[:skip_invite])
          send_clerk_invitation_and_email(user) if is_new && !skip
          render json: { user: user_json(user) }, status: :created
        else
          render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/users/:id/resend_invite
      def resend_invite
        if @user.clerk_id.blank? || !@user.clerk_id.start_with?("pending_")
          return render json: { error: "User has already signed in — no invite needed" }, status: :unprocessable_entity
        end

        send_clerk_invitation_and_email(@user)
        render json: { message: "Invite re-sent to #{@user.email}" }
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

      # DELETE /api/v1/users/:id
      def destroy
        if @user.id == current_user.id
          return render json: { error: "You cannot delete yourself" }, status: :unprocessable_entity
        end

        @user.enrollments.destroy_all
        @user.submissions.destroy_all
        @user.destroy!
        render json: { message: "User deleted" }
      end

      private

      def set_user
        @user = User.find(params[:id])
      end

      def user_params
        params.permit(:first_name, :last_name, :role, :github_username, :avatar_url)
      end

      def user_create_params
        params.permit(:email, :github_username)
      end

      def send_clerk_invitation_and_email(user)
        invitation_url = nil

        clerk = ClerkInvitationService.new
        if clerk.configured?
          result = clerk.create_invitation(
            email: user.email,
            redirect_url: frontend_url,
            ignore_existing: true
          )
          invitation_url = result[:url] if result[:success]
        end

        SendUserInviteEmailJob.perform_later(user.id, current_user&.id, invitation_url)
      end

      def frontend_url
        ENV.fetch("FRONTEND_URL", "http://localhost:5173").split(",").first.strip
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
