module Api
  module V1
    class RecordingsController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!, only: [ :create, :update, :destroy, :presign, :reorder, :lesson_options ]
      before_action :set_cohort
      before_action -> { require_feature!("recordings", @cohort) }
      before_action :authorize_cohort_access!
      before_action :set_recording, only: [ :show, :update, :destroy, :stream_url ]

      # GET /api/v1/cohorts/:cohort_id/recordings
      def index
        recordings = @cohort.recordings.ordered.includes(:uploaded_by)

        if current_user.staff?
          render json: { recordings: with_attached_lessons(recordings).map { |r| recording_json(r, staff: true) } }
        else
          enrollment = current_user.enrollments.with_read_access.find_by(cohort: @cohort)
          unless enrollment
            render_forbidden("Not enrolled in this cohort")
            return
          end

          recordings = recordings.student_visible.select { |recording| enrollment.recording_available_for_read?(recording) }

          progress_map = current_user.watch_progresses
            .where(recording_id: recordings.map(&:id))
            .index_by(&:recording_id)

          render json: {
            recordings: recordings.map { |r| recording_json(r, progress: progress_map[r.id]) }
          }
        end
      end

      # GET /api/v1/cohorts/:cohort_id/recordings/lesson_options
      def lesson_options
        @cohort.cohort_module_schedules.load
        lessons = attachable_lessons(@cohort).joins(:curriculum_module).includes(:curriculum_module)
          .order("modules.position", "modules.id", :release_day, :position, :id)

        render json: { lessons: lessons.map { |lesson|
          mod = lesson.curriculum_module
          week_starts_on = unless @cohort.self_paced? || @cohort.start_date.nil?
            mod.start_date_for(@cohort) - mod.first_scheduled_day_index + lesson.release_day.div(7) * 7
          end
          attached_lesson_json(lesson, @cohort).merge(week_starts_on: week_starts_on)
        } }
      end

      # GET /api/v1/cohorts/:cohort_id/recordings/:id
      def show
        unless recording_available_to_current_user?
          render_forbidden("Recording is not available")
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
        if params.key?(:source_url)
          create_external_recording
          return
        end

        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        # Apply the same content_type validation that presign uses so a forged
        # create payload can't persist a non-video MIME (e.g. application/zip)
        # against an s3_key that may have been uploaded under it. Presign is
        # the gatekeeper for the upload itself, but create is what makes the
        # record visible to students, so the same regex must hold here.
        content_type = validated_video_content_type(params[:content_type] || "video/mp4")
        return if content_type.nil?

        upload_error = validate_uploaded_object!(content_type)
        if upload_error
          render json: { error: upload_error }, status: :unprocessable_entity
          return
        end

        create_recording(
          s3_key: params[:s3_key],
          content_type: content_type,
          file_size: params[:file_size],
          source_kind: "uploaded"
        )
      end

      # PATCH /api/v1/cohorts/:cohort_id/recordings/:id
      def update
        # Position changes must go through `reorder`, which validates the full
        # cohort list under a lock. Allowing arbitrary per-row `position` here
        # would bypass those guarantees and let a forged PATCH create duplicate
        # slots or partial reorder states.
        permitted = params.permit(:title, :description, :duration_seconds, :recorded_date, :status, :source_url)
        if permitted.key?(:source_url)
          if @recording.uploaded?
            render json: { error: "Uploaded recordings cannot be changed to external links" }, status: :unprocessable_entity
            return
          end
          permitted[:source_kind] = Recording.source_kind_for(permitted[:source_url])
        end

        # Use the same lock as curriculum copy, which remaps these attachments
        # while holding the cohort. Reload after locking so edits use its current curriculum.
        @recording = Cohort.transaction do
          cohort = Cohort.lock("FOR NO KEY UPDATE").find(@cohort.id)
          recording = cohort.recordings.lock("FOR NO KEY UPDATE").find(@recording.id)
          save_recording!(recording, permitted)
        end
        render json: { recording: recording_json(@recording, staff: true) }
      rescue ActiveRecord::RecordInvalid => error
        render_recording_errors(error.record)
      end

      # DELETE /api/v1/cohorts/:cohort_id/recordings/:id
      def destroy
        @recording.destroy!
        head :no_content
      rescue ActiveRecord::RecordNotDestroyed
        render json: { error: "Failed to delete recording" }, status: :unprocessable_entity
      end

      # GET /api/v1/cohorts/:cohort_id/recordings/:id/stream_url
      def stream_url
        unless recording_available_to_current_user?
          render_forbidden("Recording is not available")
          return
        end

        unless @recording.uploaded?
          render json: { error: "External recordings use their original host" }, status: :unprocessable_entity
          return
        end

        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        expiry = video_stream_expiry_for(@recording_read_enrollment)
        return unless expiry

        expires_at = expiry.seconds.from_now
        url = S3Service.generate_presigned_url(@recording.s3_key, expires_in: expiry)
        render json: { stream_url: url, expires_at: expires_at.iso8601 }
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
          locked_cohort = Cohort.lock("FOR NO KEY UPDATE").find(@cohort.id)
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
          recordings: with_attached_lessons(@cohort.recordings.ordered.includes(:uploaded_by)).map { |r| recording_json(r, staff: true) }
        }
      end

      private

      def set_cohort
        @cohort = Cohort.find(params[:cohort_id])
      end

      def authorize_cohort_access!
        require_cohort_access!(@cohort, teacher: current_user.staff?)
      end

      def set_recording
        @recording = @cohort.recordings.find(params[:id])
      end

      def enrolled_in_cohort?
        @recording_read_enrollment = current_user.enrollments.with_read_access.find_by(cohort: @cohort)
        @recording_read_enrollment.present?
      end

      def recording_available_to_current_user?
        current_user.can_teach_cohort?(@cohort) || (enrolled_in_cohort? && @recording_read_enrollment.recording_available_for_read?(@recording))
      end

      def publish_immediately?
        ActiveModel::Type::Boolean.new.cast(params[:publish_immediately])
      end

      def recording_json(recording, staff: false, progress: nil)
        json = {
          id: recording.id,
          cohort_id: recording.cohort_id,
          title: recording.title,
          description: recording.description,
          source: recording.source_kind,
          url: recording.source_url,
          content_type: recording.content_type,
          file_size: recording.file_size,
          file_size_display: recording.file_size_display,
          duration_seconds: recording.duration_seconds,
          duration_display: recording.duration_display,
          status: recording.status,
          position: recording.position,
          recorded_date: recording.recorded_date&.strftime("%Y-%m-%d"),
          created_at: recording.created_at
        }

        if staff
          json[:s3_key] = recording.s3_key
          json[:uploaded_by] = recording.uploaded_by&.full_name
          json[:lessons] = recording.lesson_recordings.map { |row| attached_lesson_json(row.lesson, @cohort) }
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

      def validate_uploaded_object!(content_type)
        key = params[:s3_key].to_s
        return "s3_key is required" if key.blank?

        expected_prefix = "recordings/cohort_#{@cohort.id}/"
        return "s3_key must belong to this cohort" unless key.start_with?(expected_prefix)

        metadata = S3Service.object_metadata(key)
        return "Uploaded video was not found in S3" unless metadata

        expected_size = params[:file_size].to_i
        if expected_size.positive? && metadata[:content_length].to_i != expected_size
          return "Uploaded video size does not match"
        end

        uploaded_content_type = metadata[:content_type].to_s.split(";").first.to_s.strip.downcase
        return nil if uploaded_content_type == content_type

        "Uploaded video content type does not match"
      end

      def create_external_recording
        create_recording(source_kind: Recording.source_kind_for(params[:source_url]), source_url: params[:source_url])
      end

      def create_recording(source_attributes)
        recording = Cohort.transaction do
          cohort = Cohort.lock("FOR NO KEY UPDATE").find(@cohort.id)
          recording = cohort.recordings.build(
            title: params[:title],
            description: params[:description],
            duration_seconds: params[:duration_seconds],
            recorded_date: params[:recorded_date],
            uploaded_by: current_user,
            status: publish_immediately? ? :published : :draft,
            position: cohort.recordings.maximum(:position).to_i + 1,
            **source_attributes
          )
          save_recording!(recording)
        end

        render json: { recording: recording_json(recording, staff: true) }, status: :created
      rescue ActiveRecord::RecordInvalid => error
        render_recording_errors(error.record)
      end

      def save_recording!(recording, attributes = {})
        lessons = requested_lessons(recording) if params.key?(:lesson_ids)
        recording.update!(attributes)
        if lessons
          recording.lesson_recordings.delete_all
          lessons.each_with_index do |lesson, position|
            recording.lesson_recordings.create!(lesson: lesson, position: position)
          end
        end
        recording
      end

      def requested_lessons(recording)
        value = params[:lesson_ids]
        if value.is_a?(Array) && value.all? { |id| id.to_s.match?(/\A[0-9]+\z/) }
          ids = value.map(&:to_i).uniq
          # Prevent an archive/delete between validation and attachment. The
          # cohort lock already protects against moving to a curriculum copy.
          lessons = attachable_lessons(recording.cohort).where(id: ids).order(:id).lock("FOR SHARE").index_by(&:id)
          return lessons.values_at(*ids) if lessons.size == ids.size
        end

        recording.errors.add(:lesson_ids, "must identify active lessons in this cohort's curriculum")
        raise ActiveRecord::RecordInvalid.new(recording)
      end

      def attachable_lessons(cohort)
        Lesson.active.where(module_id: CurriculumModule.where(curriculum_id: cohort.curriculum_id).select(:id))
      end

      def with_attached_lessons(recordings)
        recordings.includes(lesson_recordings: { lesson: :curriculum_module })
      end

      def attached_lesson_json(lesson, cohort)
        mod = lesson.curriculum_module
        { id: lesson.id, title: lesson.title, module_id: mod.id, module_name: mod.name,
          week: cohort.self_paced? ? nil : CourseWeeks.number(mod, lesson) }
      end

      def render_recording_errors(record)
        render json: { errors: record.errors.full_messages }, status: :unprocessable_entity
      end
    end
  end
end
