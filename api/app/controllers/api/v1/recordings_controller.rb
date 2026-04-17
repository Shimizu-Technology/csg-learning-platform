module Api
  module V1
    class RecordingsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!, only: [ :create, :update, :destroy, :presign, :reorder ]
      before_action :set_cohort
      before_action :set_recording, only: [ :show, :update, :destroy, :stream_url ]

      # GET /api/v1/cohorts/:cohort_id/recordings
      def index
        recordings = @cohort.recordings.ordered.includes(:uploaded_by)

        if current_user.staff?
          render json: { recordings: recordings.map { |r| recording_json(r, staff: true) } }
        else
          enrollment = current_user.enrollments.find_by(cohort: @cohort, status: :active)
          unless enrollment
            render_forbidden("Not enrolled in this cohort")
            return
          end

          progress_map = current_user.watch_progresses
            .where(recording_id: recordings.map(&:id))
            .index_by(&:recording_id)

          render json: {
            recordings: recordings.map { |r| recording_json(r, progress: progress_map[r.id]) }
          }
        end
      end

      # GET /api/v1/cohorts/:cohort_id/recordings/:id
      def show
        unless current_user.staff? || enrolled_in_cohort?
          render_forbidden("Not enrolled in this cohort")
          return
        end

        progress = current_user.watch_progresses.find_by(recording: @recording) unless current_user.staff?

        render json: {
          recording: recording_json(@recording, staff: current_user.staff?, progress: progress)
        }
      end

      # POST /api/v1/cohorts/:cohort_id/recordings/presign
      def presign
        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        filename = params[:filename]
        content_type = params[:content_type] || "video/mp4"
        timestamp = Time.current.strftime("%Y%m%d%H%M%S")
        safe_name = filename.to_s.gsub(/[^a-zA-Z0-9._-]/, "_")
        s3_key = "recordings/cohort_#{@cohort.id}/#{timestamp}_#{SecureRandom.hex(4)}_#{safe_name}"

        presigned = S3Service.generate_presigned_post(s3_key, content_type)

        render json: {
          upload_url: presigned.url,
          fields: presigned.fields,
          s3_key: s3_key
        }
      end

      # POST /api/v1/cohorts/:cohort_id/recordings
      def create
        # Serialize concurrent creates so two simultaneous uploads can't compute
        # the same `next_position` and produce duplicate slots. Locking the cohort
        # row inside a transaction is enough — every position write for this
        # cohort goes through here (and `reorder` already replaces them wholesale).
        recording = nil
        Cohort.transaction do
          locked_cohort = Cohort.lock.find(@cohort.id)
          next_position = locked_cohort.recordings.maximum(:position).to_i + 1

          recording = locked_cohort.recordings.new(
            title: params[:title],
            description: params[:description],
            s3_key: params[:s3_key],
            content_type: params[:content_type] || "video/mp4",
            file_size: params[:file_size],
            duration_seconds: params[:duration_seconds],
            recorded_date: params[:recorded_date],
            uploaded_by: current_user,
            position: next_position
          )
          recording.save
        end

        if recording.persisted?
          render json: { recording: recording_json(recording, staff: true) }, status: :created
        else
          render json: { errors: recording.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/cohorts/:cohort_id/recordings/:id
      def update
        permitted = params.permit(:title, :description, :duration_seconds, :recorded_date, :position)

        if @recording.update(permitted)
          render json: { recording: recording_json(@recording, staff: true) }
        else
          render json: { errors: @recording.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # DELETE /api/v1/cohorts/:cohort_id/recordings/:id
      def destroy
        key_to_delete = @recording.s3_key
        @recording.destroy!
        S3Service.delete_object(key_to_delete) if S3Service.configured?
        head :no_content
      rescue ActiveRecord::RecordNotDestroyed
        render json: { error: "Failed to delete recording" }, status: :unprocessable_entity
      end

      # GET /api/v1/cohorts/:cohort_id/recordings/:id/stream_url
      def stream_url
        unless current_user.staff? || enrolled_in_cohort?
          render_forbidden("Not enrolled in this cohort")
          return
        end

        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        url = S3Service.generate_presigned_url(@recording.s3_key, expires_in: 7200)
        render json: { stream_url: url }
      end

      # PATCH /api/v1/cohorts/:cohort_id/recordings/reorder
      def reorder
        ordered_ids = params[:recording_ids]
        return head(:bad_request) unless ordered_ids.is_a?(Array) && ordered_ids.all? { |i| i.to_s.match?(/\A\d+\z/) }

        # Dedup so a duplicate id in the payload can't produce two writes to
        # the same row.
        ids = ordered_ids.map(&:to_i).uniq
        return head(:bad_request) if ids.empty?

        # Constrain to this cohort's recordings so a forged payload can't
        # reorder another cohort's rows.
        valid_ids = @cohort.recordings.where(id: ids).pluck(:id).to_set
        targets = ids.each_with_index.select { |id, _| valid_ids.include?(id) }
        return head(:bad_request) if targets.empty?

        # Single UPDATE via a VALUES join with parameterized binds — keeps
        # Brakeman happy (no string interpolation of params), avoids N+1, and
        # implicitly leaves any row whose id slipped out of the join unchanged
        # (no risk of NULL position from a stray CASE branch).
        placeholders = targets.map { "(?, ?)" }.join(", ")
        binds = targets.flat_map { |id, idx| [ id, idx ] }
        sql = ActiveRecord::Base.sanitize_sql_array([
          "UPDATE recordings AS r SET position = v.pos " \
          "FROM (VALUES #{placeholders}) AS v(id, pos) " \
          "WHERE r.id = v.id AND r.cohort_id = ?",
          *binds, @cohort.id
        ])
        ActiveRecord::Base.connection.exec_update(sql)

        render json: {
          recordings: @cohort.recordings.reload.ordered.map { |r| recording_json(r, staff: true) }
        }
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def set_recording
        @recording = @cohort.recordings.find(params[:id])
      end

      def enrolled_in_cohort?
        current_user.enrollments.exists?(cohort: @cohort, status: :active)
      end

      def recording_json(recording, staff: false, progress: nil)
        json = {
          id: recording.id,
          cohort_id: recording.cohort_id,
          title: recording.title,
          description: recording.description,
          content_type: recording.content_type,
          file_size: recording.file_size,
          file_size_display: recording.file_size_display,
          duration_seconds: recording.duration_seconds,
          duration_display: recording.duration_display,
          position: recording.position,
          recorded_date: recording.recorded_date&.strftime("%Y-%m-%d"),
          created_at: recording.created_at
        }

        if staff
          json[:s3_key] = recording.s3_key
          json[:uploaded_by] = recording.uploaded_by&.full_name
        end

        if progress
          json[:watch_progress] = {
            last_position_seconds: progress.last_position_seconds,
            total_watched_seconds: progress.total_watched_seconds,
            progress_percentage: progress.progress_percentage,
            completed: progress.completed,
            last_watched_at: progress.last_watched_at
          }
        end

        json
      end
    end
  end
end
