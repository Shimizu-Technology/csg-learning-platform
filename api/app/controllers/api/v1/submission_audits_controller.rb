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
        block = ContentBlock.find(params[:id])
        block.with_lock do
          if params[:content_digest] != SubmissionAudit.digest(block)
            render json: { error: "This block changed. Reload the audit before reviewing it." }, status: :conflict
            return
          end
          review = block.submission_audit_review || block.build_submission_audit_review
          review.update!(content_digest: SubmissionAudit.digest(block), reviewed_by: current_user)
          render json: { reviewed_by_id: review.reviewed_by_id, reviewed_at: review.updated_at.iso8601(6) }
        end
      end
    end
  end
end
