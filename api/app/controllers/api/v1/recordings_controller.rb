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

        content_type = validated_video_content_type(params[:content_type] || "video/mp4")
        return if content_type.nil?

        filename = params[:filename]
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
        # Apply the same content_type validation that presign uses so a forged
        # create payload can't persist a non-video MIME (e.g. application/zip)
        # against an s3_key that may have been uploaded under it. Presign is
        # the gatekeeper for the upload itself, but create is what makes the
        # record visible to students, so the same regex must hold here.
        content_type = validated_video_content_type(params[:content_type] || "video/mp4")
        return if content_type.nil?

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
            content_type: content_type,
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
        # Position changes must go through `reorder`, which validates the full
        # cohort list under a lock. Allowing arbitrary per-row `position` here
        # would bypass those guarantees and let a forged PATCH create duplicate
        # slots or partial reorder states.
        permitted = params.permit(:title, :description, :duration_seconds, :recorded_date)

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

        Cohort.transaction do
          # Lock the cohort row to serialise concurrent reorders/creates so a
          # caller-supplied "full list" doesn't race a brand-new recording
          # being inserted at maximum(position)+1 and re-introduce duplicates.
          locked_cohort = Cohort.lock.find(@cohort.id)
          existing_ids = locked_cohort.recordings.pluck(:id).to_set

          # Require the payload to cover the entire current set. A partial
          # list would only update the supplied rows to indices [0..N-1] and
          # leave the rest at their previous positions — guaranteeing position
          # collisions (e.g. a row already at position 0 colliding with the
          # newly-zeroed first id of the partial list).
          unless ids.to_set == existing_ids
            render json: {
              error: "recording_ids must include exactly the cohort's current recordings"
            }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          # Single UPDATE via a VALUES join with parameterized binds — keeps
          # Brakeman happy (no string interpolation of params) and avoids N+1.
          targets = ids.each_with_index.to_a
          placeholders = targets.map { "(?, ?)" }.join(", ")
          binds = targets.flat_map { |id, idx| [ id, idx ] }
          sql = ActiveRecord::Base.sanitize_sql_array([
            "UPDATE recordings AS r SET position = v.pos " \
            "FROM (VALUES #{placeholders}) AS v(id, pos) " \
            "WHERE r.id = v.id AND r.cohort_id = ?",
            *binds, locked_cohort.id
          ])
          ActiveRecord::Base.connection.exec_update(sql)
        end
        return if performed?

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
