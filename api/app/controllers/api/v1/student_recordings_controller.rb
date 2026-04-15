module Api
  module V1
    class StudentRecordingsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/recordings
      # Returns both legacy (YouTube/URL-based from cohort settings) and
      # S3-backed recordings for the student's active cohort.
      def index
        enrollment = current_user.enrollments.active.includes(:cohort).first

        unless enrollment
          render json: { recordings: [], s3_recordings: [] }
          return
        end

        cohort = enrollment.cohort

        legacy = Array((cohort.settings || {})["recordings"]).map.with_index do |r, i|
          {
            id: i + 1,
            title: r["title"],
            url: r["url"],
            date: r["date"],
            description: r["description"],
            source: "youtube"
          }
        end

        s3_recordings = cohort.recordings.ordered
        progress_map = current_user.watch_progresses
          .where(recording_id: s3_recordings.map(&:id))
          .index_by(&:recording_id)

        s3_list = s3_recordings.map do |r|
          wp = progress_map[r.id]
          {
            id: r.id,
            title: r.title,
            description: r.description,
            duration_seconds: r.duration_seconds,
            duration_display: r.duration_display,
            file_size_display: r.file_size_display,
            recorded_date: r.recorded_date,
            created_at: r.created_at,
            source: "s3",
            watch_progress: wp ? {
              last_position_seconds: wp.last_position_seconds,
              total_watched_seconds: wp.total_watched_seconds,
              progress_percentage: wp.progress_percentage,
              completed: wp.completed,
              last_watched_at: wp.last_watched_at
            } : nil
          }
        end

        render json: {
          recordings: legacy,
          s3_recordings: s3_list,
          cohort_id: cohort.id
        }
      end
    end
  end
end
