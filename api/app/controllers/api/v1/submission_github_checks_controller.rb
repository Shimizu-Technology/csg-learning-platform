module Api
  module V1
    class SubmissionGithubChecksController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :set_submission
      before_action :authorize_read!
      before_action -> { require_feature!("github_sync", @submission.enrollment&.cohort) }

      def show
        render json: { github_checks: GithubCheckRunSerializer.collection_json(@submission) }
      end

      def create
        require_staff!
        return if performed?
        unless @submission.enrollment.present? && current_user.can_teach_cohort?(@submission.enrollment.cohort)
          render_forbidden("Cannot refresh checks for this submission")
          return
        end

        token = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
        unless token.present? || GithubRepositoryAccess.enabled?(@submission.enrollment&.cohort)
          render json: { error: "GitHub token not configured" }, status: :service_unavailable
          return
        end

        result = GithubCheckRunSyncService.new(submission: @submission, token: token).call
        if result[:error]
          render json: { error: result[:error] }, status: :unprocessable_entity
        else
          @submission.reload
          payload = { github_checks: GithubCheckRunSerializer.collection_json(@submission) }
          cohort = @submission.enrollment&.cohort
          if cohort && GithubGradeSuggestionEvaluator.enabled_for?(cohort)
            suggestion = @submission.submission_grade_suggestion
            if suggestion
              active_policy = ExerciseCheckPolicy.active.find_by(content_block_id: @submission.content_block_id)
              payload[:grade_suggestion] = suggestion.to_staff_json(
                active_policy: active_policy,
                latest_submission_id: @submission.latest_attempt&.id,
                submission_commit_sha: @submission.commit_sha
              )
            end
          end
          render json: payload
        end
      end

      private

      def set_submission
        @submission = Submission.find(params[:submission_id])
      end

      def authorize_read!
        return if @submission.user_id == current_user.id
        return if current_user.staff? && @submission.enrollment && current_user.can_teach_cohort?(@submission.enrollment.cohort)

        render_forbidden("Cannot view this submission")
      end
    end
  end
end
