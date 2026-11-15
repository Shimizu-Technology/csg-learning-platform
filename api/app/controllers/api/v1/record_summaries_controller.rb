module Api
  module V1
    # GET /api/v1/records/:type/:id/summary — what a peek card shows (L-0.5).
    # GET /api/v1/records/:type/:id/related — a record page's related panel (L-0.4).
    # Anything the viewer can't open answers 404, the same as a record that
    # doesn't exist, so a peek never confirms another learner or cohort exists.
    class RecordSummariesController < ApplicationController
      before_action :authenticate_user!

      def show
        summary = RecordSummary.for(viewer: current_user, type: params[:type], id: params[:id], cohort_id: params[:cohort_id])
        # Facts are per viewer and change as work arrives; the web app keeps its own short cache.
        response.headers["Cache-Control"] = "private, no-store"
        if summary
          render json: { summary: summary }
        else
          render json: { error: "Not found" }, status: :not_found
        end
      end

      # GET /api/v1/records/:type/:id/related — a record page's related panel
      # and breadcrumb names (L-0.4), in one request. Same 404 rule as above.
      def related
        related = RecordRelated.for(viewer: current_user, type: params[:type], id: params[:id], cohort_id: params[:cohort_id], student_id: params[:student_id])
        response.headers["Cache-Control"] = "private, no-store"
        if related
          render json: { related: related }
        else
          render json: { error: "Not found" }, status: :not_found
        end
      end
    end
  end
end
