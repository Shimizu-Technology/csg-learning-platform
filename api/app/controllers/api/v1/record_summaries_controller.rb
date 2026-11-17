module Api
  module V1
    # GET /api/v1/records/:type/:id/summary — what a peek card shows (L-0.5).
    # GET /api/v1/records/:type/:id/related — a record page's related panel (L-0.4).
    # GET /api/v1/records/:type/:id/usage — where content is used (L-3.2, L-5), staff only.
    # GET /api/v1/records/:type/:id/detail — the staff record pages added in L-5.2, staff only.
    # Anything the viewer can't open answers 404, the same as a record that
    # doesn't exist, so a peek never confirms another learner or cohort exists.
    class RecordSummariesController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits

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

      # GET /api/v1/records/:type/:id/usage — the cohorts, schedules, work and
      # copies a curriculum, module or lesson is used in (RecordUsage). Staff
      # only; instructors see only the cohorts they teach. Same 404 rule.
      def usage
        usage = RecordUsage.for(viewer: current_user, type: params[:type], id: params[:id])
        response.headers["Cache-Control"] = "private, no-store"
        if usage
          render json: { usage: usage }
        else
          render json: { error: "Not found" }, status: :not_found
        end
      end

      # GET /api/v1/records/:type/:id/detail — a staff record page for a
      # recording, office-hour session, private-meeting booking, learning plan,
      # channel, rubric or activity event (RecordDetail). Staff only;
      # instructors open only records in cohorts they teach. Same 404 rule.
      # `page` pages a long list (a recording's watchers), 1-based.
      def detail
        detail = RecordDetail.for(viewer: current_user, type: params[:type], id: params[:id], page: params[:page])
        response.headers["Cache-Control"] = "private, no-store"
        if detail
          render json: { detail: detail }
        else
          render json: { error: "Not found" }, status: :not_found
        end
      end
    end
  end
end
