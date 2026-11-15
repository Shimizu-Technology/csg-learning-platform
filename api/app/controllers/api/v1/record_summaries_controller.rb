module Api
  module V1
    # GET /api/v1/records/:type/:id/summary — what a peek card shows (L-0.5).
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
    end
  end
end
