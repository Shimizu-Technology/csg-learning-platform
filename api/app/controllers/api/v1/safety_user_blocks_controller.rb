module Api
  module V1
    # GET /api/v1/safety/user_blocks — who has blocked whom, for admins (L-3.5).
    # Read-only: a block belongs to the person who made it, so admins can see
    # it but not lift it. Newest first, paginated. `user_id` lists only the
    # blocks that person made or received, with `person` naming them.
    class SafetyUserBlocksController < ApplicationController
      PER_PAGE = 25
      MAX_PER_PAGE = 100

      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def index
        scope = UserBlock.all
        person = safety_person
        scope = scope.where(blocker_id: person.id).or(scope.where(blocked_user_id: person.id)) if person
        scope = scope.none if person == false
        total_count = scope.count
        blocks = scope.includes(:blocker, :blocked_user).recent_first
          .offset((page_param - 1) * per_page_param).limit(per_page_param)
        total_pages = (total_count.to_f / per_page_param).ceil
        render json: {
          user_blocks: blocks.map { |block| block_json(block) },
          meta: { page: page_param, per_page: per_page_param, total_count: total_count, total_pages: total_pages, has_next_page: page_param < total_pages, has_prev_page: page_param > 1 },
          **(person ? { person: { id: person.id, full_name: person.full_name } } : {})
        }
      end

      private

      # The person in `user_id`: the user, false when the id names nobody, or nil when absent.
      def safety_person
        return nil if params[:user_id].blank?

        id = Integer(params[:user_id].to_s, 10, exception: false)
        (id&.positive? && User.find_by(id: id)) || false
      end

      def page_param
        params.fetch(:page, 1).to_i.clamp(1, 10_000)
      end

      def per_page_param
        params.fetch(:per_page, PER_PAGE).to_i.clamp(1, MAX_PER_PAGE)
      end

      def block_json(block)
        { id: block.id, blocked_at: block.created_at, blocker: person_json(block.blocker), blocked_user: person_json(block.blocked_user) }
      end

      def person_json(user)
        { id: user.id, full_name: user.full_name, email: user.email, role: user.role, archived: user.archived? }
      end
    end
  end
end
