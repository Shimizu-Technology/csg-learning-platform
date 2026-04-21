module Api
  module V1
    class WorkspaceMembershipsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!
      before_action :set_workspace

      def create
        unless @workspace.community?
          render json: { errors: [ "Cohort workspace membership is managed by cohort enrollments" ] }, status: :unprocessable_entity
          return
        end

        user_ids = Array(params[:user_ids]).map(&:to_i).reject(&:zero?).uniq
        users = User.where(id: user_ids).to_a

        if users.length != user_ids.length
          render json: { errors: [ "One or more users could not be found" ] }, status: :not_found
          return
        end

        users.each do |user|
          @workspace.workspace_memberships.create_or_find_by!(user: user) do |membership|
            membership.role = :member
          end
        end

        render json: { workspace: workspace_json(@workspace.reload) }, status: :created
      end

      def destroy
        unless @workspace.community?
          render json: { errors: [ "Cohort workspace membership is managed by cohort enrollments" ] }, status: :unprocessable_entity
          return
        end

        membership = @workspace.workspace_memberships.find_by(user_id: params[:id])
        if membership.nil?
          render json: { errors: [ "Membership not found" ] }, status: :not_found
          return
        end

        membership.destroy!
        render json: { workspace: workspace_json(@workspace.reload) }
      end

      private

      def set_workspace
        @workspace = Workspace.includes(:cohort, workspace_memberships: :user).find(params[:workspace_id])
      end

      def workspace_json(workspace)
        memberships = workspace.workspace_memberships.includes(:user).index_by(&:user_id)

        {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          workspace_type: workspace.workspace_type,
          status: workspace.status,
          cohort_id: workspace.cohort_id,
          cohort_name: workspace.cohort&.name,
          description: workspace.description,
          member_count: workspace.listed_members.count,
          can_manage: current_user.staff? && workspace.community?,
          members: workspace.listed_members.map do |user|
            membership = memberships[user.id]

            {
              id: user.id,
              full_name: user.full_name,
              email: user.email,
              role: user.role,
              avatar_url: user.avatar_url,
              membership_role: membership&.role || "member"
            }
          end,
          created_at: workspace.created_at,
          updated_at: workspace.updated_at
        }
      end
    end
  end
end
