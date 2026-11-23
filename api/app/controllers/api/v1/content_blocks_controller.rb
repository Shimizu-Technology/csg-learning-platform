module Api
  module V1
    class ContentBlocksController < ApplicationController
      before_action :authenticate_user!
      include AuthenticatedRateLimits
      before_action :require_staff!, except: [ :video_stream, :video_progress ]
      before_action :require_student!, only: [ :video_progress ]
      include LessonEditAuthorization
      before_action :set_lesson, only: [ :index, :create ]
      before_action :set_content_block, only: [ :show, :update, :destroy, :video_presign, :video_stream, :video_progress ]
      # Admins, or instructors with editing access for every cohort using the
      # lesson's curriculum (LessonEditAccess). Writes re-check in their
      # transaction before the lesson lock.
      before_action -> { require_lesson_edit_access!(edited_lesson.curriculum_module.curriculum) }, only: [ :create, :update, :destroy, :video_presign ]
      before_action :require_lesson_media_upload_access!, only: [ :generic_video_presign ]
      before_action :authorize_video_access!, only: [ :video_stream ]
      before_action :authorize_video_progress!, only: [ :video_progress ]

      # GET /api/v1/lessons/:lesson_id/content_blocks
      def index
        blocks = @lesson.content_blocks
        render json: { content_blocks: blocks.map { |cb| block_json(cb) } }
      end

      # GET /api/v1/content_blocks/:id
      def show
        render json: { content_block: block_json(@content_block) }
      end

      # POST /api/v1/lessons/:lesson_id/content_blocks
      def create
        block = @lesson.content_blocks.new(block_params)
        stamp_s3_video_upload_metadata(block) if block.s3_video_key.present?
        saved = ApplicationRecord.transaction do
          block.verified_s3_video_key = verify_new_video_key!(block.s3_video_key, current: nil)
          recheck_lesson_edit_access!(@lesson.curriculum_module.curriculum)
          @lesson.with_authoring_lock do
            block.save || raise(ActiveRecord::Rollback)
          end
        end
        return if performed?

        if saved
          render json: { content_block: block_json(block) }, status: :created
        else
          render json: { errors: block.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/content_blocks/:id
      #
      # Replacing a video (hosted upload or link) that students have progress
      # on resets that progress, so it's refused with 422 unless the request
      # sends confirm_watch_reset=true. Installed mobile builds can't ask for
      # that confirmation; they show the refusal, which points to the web
      # editor. Old watch credit is never carried over to new media.
      def update
        old_s3_key = @content_block.s3_video_key

        ApplicationRecord.transaction do
          # Storage is checked before the lesson or block is locked.
          verified_key = verify_new_video_key!(block_params[:s3_video_key], current: @content_block.s3_video_key)
          recheck_lesson_edit_access!(edited_lesson.curriculum_module.curriculum)
          @content_block.lesson.with_authoring_lock do
            @content_block.reload
            old_s3_key = @content_block.s3_video_key
            @content_block.assign_attributes(block_params)
            @content_block.confirm_watch_reset = confirm_watch_reset?
            @content_block.verified_s3_video_key = verified_key

            if @content_block.s3_video_key != old_s3_key
              # The locked authoritative duration belongs to the old file. Clear
              # it so the next first reporter relocks it for the new one.
              if old_s3_key.present? && !block_params.key?(:s3_video_duration_seconds)
                @content_block.s3_video_duration_seconds = nil
              end
              if @content_block.s3_video_key.present?
                stamp_s3_video_upload_metadata(@content_block)
              else
                @content_block.s3_video_uploaded_by = nil
                @content_block.s3_video_uploaded_at = nil
              end
            end

            unless @content_block.save
              render json: { errors: @content_block.errors.full_messages }, status: :unprocessable_entity
              raise ActiveRecord::Rollback
            end
          end
        end
        return if performed?

        # S3 cleanup is intentionally outside the transaction: rolling back a
        # successful object delete is not possible, and a failed delete should
        # not block the DB update.
        if old_s3_key.present? && @content_block.s3_video_key != old_s3_key
          S3ObjectCleanup.delete_if_unreferenced(old_s3_key)
        end
        render json: { content_block: block_json(@content_block) }
      end

      # DELETE /api/v1/content_blocks/:id
      def destroy
        ApplicationRecord.transaction do
          recheck_lesson_edit_access!(edited_lesson.curriculum_module.curriculum)
          @content_block.lesson.with_authoring_lock { @content_block.destroy! }
        end
        head :no_content
      rescue ActiveRecord::RecordNotDestroyed => error
        render json: { error: error.record.errors.full_messages.to_sentence.presence || "Failed to delete content block" }, status: :unprocessable_entity
      end

      # POST /api/v1/video_presign — generic presign (staff only, no content block needed)
      def generic_video_presign
        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        content_type = validated_video_content_type(params[:content_type] || "video/mp4")
        return if content_type.nil?

        filename = params[:filename]
        safe_name = filename.to_s.gsub(/[^a-zA-Z0-9._-]/, "_")
        s3_key = "content_videos/#{SecureRandom.uuid}/#{safe_name}"

        presigned = S3Service.generate_presigned_post(s3_key, content_type)

        render json: {
          upload_url: presigned.url,
          fields: presigned.fields,
          s3_key: s3_key
        }
      end

      # POST /api/v1/content_blocks/:id/video_presign
      def video_presign
        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        content_type = validated_video_content_type(params[:content_type] || "video/mp4")
        return if content_type.nil?

        filename = params[:filename]
        timestamp = Time.current.strftime("%Y%m%d%H%M%S")
        safe_name = filename.to_s.gsub(/[^a-zA-Z0-9._-]/, "_")
        s3_key = "content_videos/block_#{@content_block.id}/#{timestamp}_#{safe_name}"

        presigned = S3Service.generate_presigned_post(s3_key, content_type)

        render json: {
          upload_url: presigned.url,
          fields: presigned.fields,
          s3_key: s3_key
        }
      end

      # GET /api/v1/content_blocks/:id/video_stream
      def video_stream
        unless @content_block.s3_video_key.present?
          render json: { error: "No video uploaded" }, status: :not_found
          return
        end

        unless S3Service.configured?
          render json: { error: "S3 not configured" }, status: :service_unavailable
          return
        end

        version = if params[:version_id].present?
          @content_block.video_versions.find { |item| item["id"] == params[:version_id] }
        else
          @content_block.video_versions.first
        end
        if params[:version_id].present? && version.nil?
          render json: { error: "Video version not found" }, status: :not_found
          return
        end

        expiry = video_stream_expiry_for(@learning_read_enrollment)
        return unless expiry

        expires_at = expiry.seconds.from_now
        url = S3Service.generate_presigned_url(version ? version["s3_video_key"] : @content_block.s3_video_key, expires_in: expiry)
        progress = current_user.progresses.find_by(enrollment: @learning_read_enrollment, content_block: @content_block) unless current_user.staff?

        sources = LessonVideoSections.new(@content_block).sources
        source = version ? sources.dig("versions", version["id"]) : sources["default"]
        render json: {
          stream_url: url,
          **(source ? { video_source: source } : {}),
          expires_at: expires_at.iso8601,
          video_progress: progress ? {
            last_position: progress.video_last_position,
            total_watched: progress.video_total_watched,
            duration: progress.video_duration,
            status: progress.status
          } : nil
        }
      end

      # PATCH /api/v1/content_blocks/:id/video_progress
      def video_progress
        with_learning_write_guard(@learning_write_enrollment) do
          unless @learning_write_enrollment.active?
            return render_forbidden("Not enrolled in this curriculum")
          end

          previous_media = ContentBlock.playable_media(@content_block.s3_video_key, @content_block.video_url)
          reported_duration = params[:duration_seconds].to_i
          source = params[:video_source]
          # The one-time duration write must go before the learner lock. A
          # conditional update cannot stamp a replaced asset or overwrite the
          # first reporter. Skip a busy row and let a later ping try again.
          stamped = establish_video_duration(reported_duration, source)
          @content_block.reload(lock: "FOR KEY SHARE")
          sections = LessonVideoSections.new(@content_block)
          if previous_media != ContentBlock.playable_media(@content_block.s3_video_key, @content_block.video_url) ||
              (params.key?(:video_source) && !sections.includes_source?(source))
            render json: { error: "The recording source changed. Reload before saving progress.", code: "video_source_changed" }, status: :conflict
            raise ActiveRecord::Rollback if stamped
            return
          end

          hosted = @content_block.s3_video_key.present?
          unless hosted || sections.sources.present?
            return render json: { error: "Content block has no video to track" }, status: :unprocessable_entity
          end
          if params.key?(:completed_section_ranges) && !recheck_content_block_write!(@content_block, @learning_write_enrollment, block_locked: true)
            raise ActiveRecord::Rollback if stamped
            return
          end

          duration = hosted ? @content_block.s3_video_duration_seconds : reported_duration.clamp(0, 28_800)
          progress = current_user.progresses.find_or_initialize_by(enrollment: @learning_write_enrollment, content_block: @content_block)
          section_result = apply_video_progress(progress, duration, sections, source)
          if progress.save
            record_video_activity!(progress)
            render_video_progress(progress, sections, section_result)
          else
            render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
          end
        end
      end

      private

      def establish_video_duration(duration, source)
        block = @content_block
        return false unless block.s3_video_key.present? && block.s3_video_duration_seconds.nil? && block.video_versions.empty? && duration.positive?
        return false if params.key?(:video_source) && !LessonVideoSections.new(block).includes_source?(source)

        eligible = ContentBlock.where(id: block.id, s3_video_key: block.s3_video_key, s3_video_duration_seconds: nil)
          .where("metadata->'video_versions' IS NULL OR metadata->'video_versions' IN ('[]'::jsonb, 'null'::jsonb)")
        eligible.where(id: eligible.select(:id).lock("FOR NO KEY UPDATE SKIP LOCKED"))
          .update_all(s3_video_duration_seconds: duration).positive?
      end

      def record_video_activity!(progress)
        CourseCompletion.evaluate!(progress.enrollment) if progress.saved_change_to_status? && progress.completed?
        event_type = if progress.saved_change_to_status? && progress.completed?
          "video_completed"
        elsif progress.saved_change_to_video_total_watched? &&
            progress.video_total_watched_before_last_save.to_i.zero? && progress.video_total_watched.to_i.positive?
          "video_started"
        end
        return unless event_type

        ActivityEvent.record!(event_type: event_type, actor: current_user,
          cohort: @learning_write_enrollment&.cohort, record: @content_block,
          evidence: "player_reported")
      end

      def apply_video_progress(progress, authoritative_duration, sections, source)
        progress.video_duration = authoritative_duration if authoritative_duration.present?
        new_position = params[:last_position_seconds].to_i
        if authoritative_duration&.positive?
          new_position = [ new_position, authoritative_duration ].min
        end
        progress.video_last_position = [ new_position, 0 ].max

        progress.video_total_watched = WatchCredit.apply(progress,
          stored: progress.video_total_watched, reported: params[:total_watched_seconds], version: params[:watch_credit_version], duration: authoritative_duration)

        result = sections.record(progress, source: source, reported: params[:completed_section_ranges],
          reported_total: params[:total_watched_seconds].to_i, duration: authoritative_duration)

        return result if @content_block.evidence_controls_completion?(@learning_write_enrollment)

        # Installed clients without section reporting keep their whole-video path.
        whole_video = (!source || !sections.core?) && authoritative_duration&.positive? &&
          progress.video_total_watched >= (authoritative_duration * 0.9)
        if whole_video || sections.core_complete?(progress, duration: authoritative_duration)
          progress.status = :completed unless progress.completed?
        elsif progress.not_started?
          progress.status = :in_progress
        end
        result
      end

      def render_video_progress(progress, sections, section_result)
        render json: {
          video_progress: {
            content_block_id: progress.content_block_id,
            last_position: progress.video_last_position,
            total_watched: progress.video_total_watched,
            duration: progress.video_duration,
            status: progress.status,
            completed: progress.completed?,
            completed_video_sections: sections.completed(progress),
            **section_result
          }
        }
      end

      def set_lesson
        @lesson = Lesson.find(params[:lesson_id])
      end

      def edited_lesson
        @lesson || @content_block.lesson
      end

      def set_content_block
        # A learner's video stream and progress follow a cohort copy's
        # redirect (MovedContent); staff edits act on the id they name.
        id = %w[video_stream video_progress].include?(action_name) ? moved_content_id("ContentBlock", params[:id]) : params[:id]
        @content_block = ContentBlock.find(id)
      end

      def authorize_video_access!
        if current_user.staff?
          return
        end

        lesson = @content_block.lesson
        scope = current_user.enrollments.joins(:cohort)
          .where(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })
        scope = if params[:cohort_id].present?
          scope.with_read_access.where(cohort_id: params[:cohort_id])
        else
          scope.active
        end
        @learning_read_enrollment = scope.order(enrolled_at: :desc, id: :desc).first
        unless @learning_read_enrollment
          render_forbidden("Not enrolled in this curriculum")
          return
        end
        assignment = @learning_read_enrollment.module_assignments.find_by(module_id: lesson.module_id)
        lesson_assignment = @learning_read_enrollment.lesson_assignments.find_by(lesson_id: lesson.id)
        unless (@learning_read_enrollment.module_reachable_for_read?(assignment) || lesson_assignment.present?) &&
            @learning_read_enrollment.lesson_available_for_read?(lesson, assignment, lesson_assignment)
          render_forbidden("Lesson is not available")
        end
      end

      # Looser gate for the player's polling save: starting playback already
      # passed `authorize_video_access!` via `video_stream`, but a lesson can
      # be locked again mid-watch (admin removes the assignment, unlock window
      # passes, etc.). Blocking the periodic progress save in that case would
      # silently drop the student's last position and watched-seconds — there's
      # no security gain (they're not gaining new access, just persisting where
      # they got to). So we only require active enrollment in the curriculum
      # here, not module/lesson availability.
      def authorize_video_progress!
        lesson = @content_block.lesson
        @learning_write_enrollment = active_enrollment_for_lesson(lesson)
        return if @learning_write_enrollment

        # Moved to the cohort's own copy after the request resolved the block.
        raise_if_content_moved!("ContentBlock", @content_block.id)
        render_forbidden("Not enrolled in this curriculum")
      end

      def block_params
        params.permit(:block_type, :position, :title, :body, :video_url, :solution, :filename, :submission_type,
                       :metadata, :s3_video_key, :s3_video_content_type, :s3_video_size, :s3_video_duration_seconds,
                       submission_config: {})
      end

      def block_json(cb)
        {
          id: cb.id,
          lesson_id: cb.lesson_id,
          block_type: cb.block_type,
          position: cb.position,
          title: cb.title,
          body: cb.body,
          video_url: cb.video_url,
          solution: cb.solution,
          filename: cb.filename,
          effective_submission_type: cb.effective_submission_type,
          submission_type: cb.effective_submission_type,
          submission_type_explicit: cb.submission_type,
          submission_config: cb.submission_config || {},
          metadata: cb.metadata,
          s3_video_key: cb.s3_video_key,
          s3_video_content_type: cb.s3_video_content_type,
          s3_video_size: cb.s3_video_size,
          # Surface the authoritative server-side duration so the editor can show
          # it without round-tripping through video_stream / video_progress.
          s3_video_duration_seconds: cb.s3_video_duration_seconds,
          s3_video_uploaded_at: cb.s3_video_uploaded_at,
          s3_video_uploaded_by: cb.s3_video_uploaded_by&.full_name
        }
      end

      def confirm_watch_reset?
        ActiveModel::Type::Boolean.new.cast(params[:confirm_watch_reset]) == true
      end

      # Checks a new hosted video in storage before any row is locked; returns
      # the key for ContentBlock#verified_s3_video_key. Runs inside the saving
      # transaction (S3ObjectCleanup.verify_attachment). On a problem it
      # renders 422 and rolls the transaction back.
      def verify_new_video_key!(key, current:)
        key = key.presence
        return nil if key.nil? || key == current

        problem = S3ObjectCleanup.verify_attachment(key)
        return key unless problem

        render json: { errors: [ "S3 video key #{problem}" ] }, status: :unprocessable_entity
        raise ActiveRecord::Rollback
      end

      def stamp_s3_video_upload_metadata(block)
        block.s3_video_uploaded_by = current_user
        block.s3_video_uploaded_at = Time.current
      end
    end
  end
end
