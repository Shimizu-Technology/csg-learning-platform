module Api
  module V1
    class SubmissionGithubChecksController < ApplicationController
      before_action :authenticate_user!
      before_action :set_submission
      before_action :authorize_read!

      def show
        render json: { github_checks: GithubCheckRunSerializer.collection_json(@submission) }
      end

      def create
        require_staff!
        return if performed?

        token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
        unless token.present?
          render json: { error: "GitHub token not configured" }, status: :service_unavailable
          return
        end

        result = GithubCheckRunSyncService.new(submission: @submission, token: token).call
        if result[:error]
          render json: { error: result[:error] }, status: :unprocessable_entity
        else
          render json: { github_checks: GithubCheckRunSerializer.collection_json(@submission.reload) }
        end
      end

      private

      def set_submission
        @submission = Submission.find(params[:submission_id])
      end

      def authorize_read!
        return if current_user.staff? || @submission.user_id == current_user.id

        render_forbidden("Cannot view this submission")
      end
    end
  end
end
