module Api
  module V1
    class WorkspacesController < ApplicationController
      before_action :authenticate_user!
      before_action :set_workspace, only: [ :show, :update ]
      before_action :require_staff!, only: [ :create, :update ]

      def index
        workspaces = Workspace.visible_for(current_user).includes(:cohort).ordered.to_a
        member_counts = member_counts_for(workspaces)

        render json: {
          workspaces: workspaces.map { |workspace| workspace_json(workspace, member_counts: member_counts) }
        }
      end

      def show
        unless @workspace.visible_to?(current_user) || current_user.staff?
          render_forbidden("Workspace is not visible")
          return
        end

        render json: {
          workspace: workspace_json(@workspace, include_members: true)
        }
      end

      def create
        workspace = Workspace.new(workspace_create_params)
        workspace.workspace_type = :community
        workspace.status ||= :active

        begin
          create_community_workspace!(workspace)
          render json: { workspace: workspace_json(workspace.reload, include_members: true) }, status: :created
        rescue ActiveRecord::RecordInvalid
          render json: { errors: workspace.errors.full_messages.presence || [ "Workspace could not be created" ] }, status: :unprocessable_entity
        rescue ActiveRecord::RecordNotFound => e
          render json: { errors: [ e.message ] }, status: :not_found
        end
      end

      def update
        unless @workspace.community?
          render json: { errors: [ "Only community workspaces can be edited manually" ] }, status: :unprocessable_entity
          return
        end

        if @workspace.update(workspace_update_params)
          render json: { workspace: workspace_json(@workspace.reload, include_members: true) }
        else
          render json: { errors: @workspace.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_workspace
        @workspace = Workspace.includes(:cohort, workspace_memberships: :user).find(params[:id])
      end

      def workspace_create_params
        params.permit(:name, :description, :status).merge(workspace_type: :community)
      end

      def workspace_update_params
        params.permit(:name, :description, :status)
      end

      def workspace_member_ids
        Array(params[:user_ids]).map(&:to_i).reject(&:zero?).uniq - [ current_user.id ]
      end

      def add_members!(workspace, user_ids)
        return if user_ids.empty?

        users = User.where(id: user_ids).to_a
        if users.length != user_ids.length
          raise ActiveRecord::RecordNotFound, "One or more users could not be found"
        end

        users.each do |user|
          workspace.workspace_memberships.create_or_find_by!(user: user) do |membership|
            membership.role = :member
          end
        end
      end

      def create_community_workspace!(workspace)
        attempts = 0

        begin
          attempts += 1
          workspace.slug = Workspace.build_community_slug(workspace.name)

          Workspace.transaction do
            workspace.save!
            workspace.workspace_memberships.create_or_find_by!(user: current_user) do |membership|
              membership.role = :manager
            end
            add_members!(workspace, workspace_member_ids)
            workspace.ensure_default_channels!
          end
        rescue ActiveRecord::RecordNotUnique
          retry if attempts < 3

          workspace.errors.add(:slug, "has already been taken")
          raise ActiveRecord::RecordInvalid, workspace
        end
      end

      def member_counts_for(workspaces)
        return {} if workspaces.empty?

        counts = {}

        cohort_ids = workspaces.select(&:cohort?).map(&:cohort_id)
        Enrollment.active.where(cohort_id: cohort_ids).group(:cohort_id).count.each do |cohort_id, count|
          counts[[ :cohort, cohort_id ]] = count
        end

        community_ids = workspaces.select(&:community?).map(&:id)
        WorkspaceMembership.where(workspace_id: community_ids).group(:workspace_id).count.each do |workspace_id, count|
          counts[[ :community, workspace_id ]] = count
        end

        counts
      end

      def workspace_json(workspace, include_members: false, member_counts: nil)
        payload = {
          id: workspace.id,
          name: workspace.name,
          slug: workspace.slug,
          workspace_type: workspace.workspace_type,
          status: workspace.status,
          cohort_id: workspace.cohort_id,
          cohort_name: workspace.cohort&.name,
          description: workspace.description,
          member_count: workspace_member_count(workspace, member_counts),
          can_manage: current_user.staff? && workspace.community?,
          created_at: workspace.created_at,
          updated_at: workspace.updated_at
        }

        if include_members
          memberships = workspace.workspace_memberships.includes(:user).index_by(&:user_id)
          payload[:members] = workspace.listed_members.map do |user|
            membership = memberships[user.id]

            {
              id: user.id,
              full_name: user.full_name,
              email: user.email,
              role: user.role,
              avatar_url: user.avatar_url,
              membership_role: membership&.role || (workspace.community? ? "member" : "cohort_member")
            }
          end
        end

        payload
      end

      def workspace_member_count(workspace, member_counts)
        return workspace.listed_members.count unless member_counts

        key = workspace.cohort? ? [ :cohort, workspace.cohort_id ] : [ :community, workspace.id ]
        member_counts.fetch(key, 0)
      end
    end
  end
end
