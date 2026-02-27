module Api
  module V1
    class SessionsController < ApplicationController
      before_action :authenticate_user!

      # POST /api/v1/sessions — Clerk auth sync
      def create
        render json: {
          user: user_json(current_user),
          enrollments: current_user.enrollments.includes(cohort: { curriculum: :modules }).map { |e|
            {
              id: e.id,
              cohort: {
                id: e.cohort.id,
                name: e.cohort.name,
                cohort_type: e.cohort.cohort_type,
                start_date: e.cohort.start_date,
                status: e.cohort.status
              },
              status: e.status,
              enrolled_at: e.enrolled_at
            }
          }
        }
      end

      private

      def user_json(user)
        {
          id: user.id,
          clerk_id: user.clerk_id,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          full_name: user.full_name,
          role: user.role,
          github_username: user.github_username,
          avatar_url: user.avatar_url,
          is_admin: user.admin?,
          is_staff: user.staff?
        }
      end
    end
  end
end
