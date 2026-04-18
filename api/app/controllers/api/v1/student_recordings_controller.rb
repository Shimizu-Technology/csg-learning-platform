module Api
  module V1
    class StudentRecordingsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/recordings
      # Returns both legacy (YouTube/URL-based from cohort settings) and
      # S3-backed recordings across all of the student's active cohorts.
      def index
        enrollments = current_user.enrollments.active.includes(:cohort).order(created_at: :desc)
        if enrollments.empty?
          render json: { recordings: [], s3_recordings: [] }
          return
        end

        cohorts = enrollments.map(&:cohort)
        legacy = cohorts.flat_map do |cohort|
          Array((cohort.settings || {})["recordings"]).map.with_index do |r, i|
            {
              # Legacy recordings don't have DB ids. Make the synthetic id stable
              # and unique across multiple active cohorts so selection keys don't
              # collide on the merged student recordings page.
              id: -((cohort.id * 100_000) + i + 1),
              cohort_id: cohort.id,
              title: r["title"],
              url: r["url"],
              date: r["date"],
              description: r["description"],
              source: "youtube"
            }
          end
        end

        s3_recordings = Recording.where(cohort_id: cohorts.map(&:id)).includes(:cohort).order(:cohort_id, :position)
        progress_map = current_user.watch_progresses
          .where(recording_id: s3_recordings.map(&:id))
          .index_by(&:recording_id)

        s3_list = s3_recordings.map do |r|
          wp = progress_map[r.id]
          {
            id: r.id,
            cohort_id: r.cohort_id,
            title: r.title,
            description: r.description,
            duration_seconds: r.duration_seconds,
            duration_display: r.duration_display,
            file_size_display: r.file_size_display,
            recorded_date: r.recorded_date&.strftime("%Y-%m-%d"),
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
          s3_recordings: s3_list
        }
      end
    end
  end
end
