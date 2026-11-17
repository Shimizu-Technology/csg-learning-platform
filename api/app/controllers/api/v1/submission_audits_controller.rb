module Api
  module V1
    class SubmissionAuditsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_admin!

      def index
        render json: { blocks: SubmissionAudit.rows }
      end

      def update
        digest = params.require(:content_digest)
        block = ContentBlock.find(params[:id])
        block.with_lock("FOR NO KEY UPDATE") do
          school = FeatureSwitches::DEFAULTS.merge((SchoolSetting.find_by(id: 1)&.features || {}).slice(*FeatureSwitches::KEYS))
          unless SubmissionAudit.candidate?(block, school: school)
            render json: { error: "This block no longer needs a submission audit review." }, status: :unprocessable_entity
            return
          end
          if digest != SubmissionAudit.digest(block)
            render json: { error: "This block changed. Reload the audit before reviewing it." }, status: :conflict
            return
          end
          review = block.submission_audit_review || block.build_submission_audit_review
          review.update!(content_digest: SubmissionAudit.digest(block), reviewed_by: current_user)
          render json: { reviewed_by_id: review.reviewed_by_id, reviewed_at: review.updated_at.iso8601(6) }
        end
      rescue ActionController::ParameterMissing
        render json: { error: "content_digest is required." }, status: :bad_request
      end
    end
  end
end
