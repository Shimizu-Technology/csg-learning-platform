module Api
  module V1
    class StudentRecordingsController < ApplicationController
      before_action :authenticate_user!

      # GET /api/v1/recordings
      # Returns the first-class recording library plus any unmigrated links
      # across all of the student's active cohorts.
      def index
        cohorts = if current_user.staff?
          Cohort.where(status: %i[active upcoming]).order(start_date: :desc).to_a
        else
          current_user.enrollments.active.includes(:cohort).order(created_at: :desc).map(&:cohort)
        end
        if cohorts.empty?
          render json: { recordings: [], s3_recordings: [], items: [] }
          return
        end

        migrated_keys = Recording.where(cohort_id: cohorts.map(&:id)).where.not(legacy_key: nil).pluck(:cohort_id, :legacy_key).to_set
        legacy = cohorts.flat_map do |cohort|
          Array((cohort.settings || {})["recordings"]).map.with_index do |r, i|
            next if migrated_keys.include?([ cohort.id, "settings-#{i + 1}" ])

            {
              # Legacy recordings don't have DB ids. Use an explicit synthetic
              # string id so merged multi-cohort playlists never depend on a
              # numeric spacing scheme or hidden per-cohort item-count ceiling.
              id: "legacy-#{cohort.id}-#{i + 1}",
              cohort_id: cohort.id,
              cohort_name: cohort.name,
              title: r["title"],
              url: r["url"],
              date: r["date"],
              description: r["description"],
              recorded_date: r["date"],
              source: recording_source_for(r["url"])
            }
          end.compact
        end

        library_recordings = Recording.where(cohort_id: cohorts.map(&:id))
        library_recordings = library_recordings.student_visible unless current_user.staff?
        library_recordings = library_recordings.includes(:cohort).order(:cohort_id, :position)
        progress_map = if current_user.staff?
          {}
        else
          current_user.watch_progresses
            .where(recording_id: library_recordings.map(&:id))
            .index_by(&:recording_id)
        end

        library_list = library_recordings.map do |r|
          wp = progress_map[r.id]
          {
            id: r.id,
            cohort_id: r.cohort_id,
            cohort_name: r.cohort.name,
            title: r.title,
            description: r.description,
            duration_seconds: r.duration_seconds,
            duration_display: r.duration_display,
            file_size_display: r.file_size_display,
            recorded_date: r.recorded_date&.strftime("%Y-%m-%d"),
            created_at: r.created_at,
            source: r.source_kind,
            url: r.source_url,
            status: r.status,
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
          s3_recordings: library_list.select { |recording| recording[:source] == "uploaded" },
          items: normalized_recording_items(library_list, legacy)
        }
      end

      private

      def normalized_recording_items(library, external)
        library_items = library.map do |recording|
          recording.merge(
            item_key: "recording-#{recording[:id]}"
          )
        end

        external_items = external.map do |recording|
          recording.merge(
            item_key: recording[:id],
            source: recording[:source]
          )
        end

        library_items + external_items
      end

      def recording_source_for(url)
        Recording.source_kind_for(url)
      end
    end
  end
end
