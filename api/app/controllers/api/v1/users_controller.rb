module Api
  module V1
    class UsersController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :index, :show ]
      before_action :require_admin!, only: [ :create, :update, :destroy, :resend_invite, :unarchive ]
      before_action :set_user, only: [ :show, :update, :destroy, :resend_invite, :unarchive ]

      # GET /api/v1/users
      def index
        include_archived = ActiveModel::Type::Boolean.new.cast(params[:include_archived])
        if include_archived && !current_user.admin?
          render_forbidden("Admin access required to include archived users")
          return
        end

        users = include_archived ? User.all : User.not_archived
        users = users.order(:last_name, :first_name)

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
        was_archived = user.archived?
        user.archived_at = nil if was_archived
        requested_role = params[:role].to_s.strip.downcase
        if User.roles.key?(requested_role)
          user.role = requested_role
        elsif is_new
          user.role = :student
        end
        user.github_username = user_create_params[:github_username] if user_create_params[:github_username].present?

        if user.save
          skip = ActiveModel::Type::Boolean.new.cast(params[:skip_invite])
          send_clerk_invitation_and_email(user) if should_send_invite?(user, is_new: is_new, was_archived: was_archived, skip: skip)
          render json: { user: user_json(user) }, status: :created
        else
          render json: { errors: user.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # POST /api/v1/users/:id/resend_invite
      def resend_invite
        if @user.archived?
          return render json: { error: "Archived users must be added again before an invite can be sent" }, status: :unprocessable_entity
        end

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
          return render json: { error: "You cannot archive yourself" }, status: :unprocessable_entity
        end

        if @user.archived?
          return render json: { message: "User already archived", action: "archived", user: user_json(@user) }
        end

        if @user.safe_to_hard_delete?
          @user.destroy!
          render json: { message: "Pending invite deleted", action: "deleted" }
        else
          @user.archive!
          render json: { message: "User archived", action: "archived", user: user_json(@user) }
        end
      end

      # PATCH /api/v1/users/:id/unarchive
      def unarchive
        unless @user.archived?
          return render json: { message: "User already active", user: user_json(@user) }
        end

        @user.unarchive!
        send_clerk_invitation_and_email(@user) if @user.invite_pending?

        render json: {
          message: @user.invite_pending? ? "User restored and invite sent" : "User restored",
          user: user_json(@user)
        }
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

        begin
          SendUserInviteEmailJob.perform_later(user.id, current_user&.id, invitation_url)
        rescue StandardError => e
          Rails.logger.error("[InviteEmail] Failed to enqueue invite for #{user.email}: #{e.message}")
        end
      end

      def should_send_invite?(user, is_new:, was_archived:, skip:)
        return false if skip
        return true if is_new

        was_archived && user.invite_pending?
      end

      def frontend_url
        FrontendUrlResolver.resolve
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
          last_seen_at: user.last_seen_at,
          archived_at: user.archived_at,
          invite_pending: user.invite_pending?,
          created_at: user.created_at
        }
      end
    end
  end
end
