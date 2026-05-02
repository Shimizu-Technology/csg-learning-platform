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
              # Legacy recordings don't have DB ids. Use an explicit synthetic
              # string id so merged multi-cohort playlists never depend on a
              # numeric spacing scheme or hidden per-cohort item-count ceiling.
              id: "legacy-#{cohort.id}-#{i + 1}",
              cohort_id: cohort.id,
              title: r["title"],
              url: r["url"],
              date: r["date"],
              description: r["description"],
              recorded_date: r["date"],
              source: recording_source_for(r["url"])
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
            source: "uploaded",
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
          items: normalized_recording_items(s3_list, legacy)
        }
      end

      private

      def normalized_recording_items(uploaded, external)
        uploaded_items = uploaded.map do |recording|
          recording.merge(
            item_key: "uploaded-#{recording[:id]}",
            source: "uploaded"
          )
        end

        external_items = external.map do |recording|
          recording.merge(
            item_key: recording[:id],
            source: recording[:source]
          )
        end

        uploaded_items + external_items
      end

      def recording_source_for(url)
        host = URI.parse(url.to_s).host.to_s.downcase
        return "youtube" if host.include?("youtube.com") || host.include?("youtu.be")
      rescue URI::InvalidURIError
        "external"
      else
        "external"
      end
    end
  end
end
