module Api
  module V1
    class SessionsController < ApplicationController
      before_action :authenticate_user!

      # POST /api/v1/sessions — Clerk auth sync
      def create
        record_new_session!

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
                status: e.cohort.status,
                course_delivery: e.cohort.course_delivery
              },
              status: e.status,
              enrolled_at: e.enrolled_at,
              access_expires_at: e.access_expires_at,
              first_opened_at: e.first_opened_at,
              support_expires_at: e.support_expires_at
            }
          }
        }
      end

      private

      def record_new_session!
        # A refresh calls this endpoint too. A Clerk sid identifies a real auth
        # session across refreshed JWTs and across web/native requests. Without
        # sid we cannot distinguish a login from a refresh, so record neither.
        return if @current_clerk_session_id.blank?

        digest = OpenSSL::HMAC.hexdigest(
          "SHA256", Rails.application.secret_key_base,
          "#{@current_clerk_issuer}\0#{@current_clerk_session_id}"
        )
        current_user.with_lock do
          next if current_user.auth_sessions.exists?(session_digest: digest)

          current_user.auth_sessions.create!(session_digest: digest)
          ActivityEvent.record!(event_type: "account_signed_in", actor: current_user)
          current_user.update!(last_sign_in_at: Time.current)
        end
      end

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
          last_seen_at: user.last_seen_at,
          is_admin: user.admin?,
          is_staff: user.staff?,
          community_policy: CommunityPolicy.as_json(user)
        }
      end
    end
  end
end
