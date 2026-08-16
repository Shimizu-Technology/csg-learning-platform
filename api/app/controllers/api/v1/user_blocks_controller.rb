module Api
  module V1
    class UserBlocksController < ApplicationController
      before_action :authenticate_user!

      def index
        blocks = current_user.user_blocks.includes(:blocked_user).order(created_at: :desc)
        render json: { blocked_users: blocks.map { |block| block_json(block) } }
      end

      def create
        blocked_user = User.not_archived.find(params[:blocked_user_id])
        unless visible_to_current_user?(blocked_user)
          render_forbidden("User is not visible")
          return
        end

        block = current_user.user_blocks.create_or_find_by!(blocked_user: blocked_user)
        render json: { blocked_user: block_json(block) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render json: { errors: error.record.errors.full_messages }, status: :unprocessable_entity
      end

      def destroy
        block = current_user.user_blocks.find_by!(blocked_user_id: params[:blocked_user_id])
        block.destroy!
        head :no_content
      end

      private

      def visible_to_current_user?(user)
        return true if current_user.staff?

        Workspace.visible_for(current_user).any? do |workspace|
          workspace.recipient_users.reorder(nil).exists?(id: user.id)
        end
      end

      def block_json(block)
        {
          id: block.blocked_user_id,
          full_name: block.blocked_user.full_name,
          avatar_url: block.blocked_user.avatar_url,
          blocked_at: block.created_at
        }
      end
    end
  end
end
