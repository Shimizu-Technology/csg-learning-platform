module Api
  module V1
    class ContentBlocksController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, except: [ :video_stream, :video_progress ]
      before_action :set_lesson, only: [ :index, :create ]
      before_action :set_content_block, only: [ :show, :update, :destroy, :video_presign, :video_stream, :video_progress ]
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
        if block.save
          render json: { content_block: block_json(block) }, status: :created
        else
          render json: { errors: block.errors.full_messages }, status: :unprocessable_entity
        end
      end

      # PATCH /api/v1/content_blocks/:id
      def update
        old_s3_key = @content_block.s3_video_key

        ContentBlock.transaction do
          unless @content_block.update(block_params)
            render json: { errors: @content_block.errors.full_messages }, status: :unprocessable_entity
            raise ActiveRecord::Rollback
          end

          # When the video binary is replaced (or removed), the previously locked
          # authoritative duration belongs to a different file. Leaving it in
          # place would let stale per-user `total_watched` values trip the 90%
          # completion check against the OLD duration the moment the new video's
          # first ping arrives — silently marking the new video complete after a
          # few seconds. Clear the duration so the next first-reporter relocks
          # it, and wipe per-user video progress so students restart cleanly.
          if old_s3_key.present? && @content_block.s3_video_key != old_s3_key
            duration_explicit = block_params.key?(:s3_video_duration_seconds)
            unless duration_explicit
              # update_column persists the change but doesn't refresh the
              # in-memory attribute, so the JSON response below would still
              # serialise the old duration. Mirror the write into the loaded
              # instance so block_json reflects reality without an extra read.
              @content_block.update_column(:s3_video_duration_seconds, nil)
              @content_block.s3_video_duration_seconds = nil
            end
            # update_all bypasses Active Record enum mapping, so pass the raw
            # integer for status: instead of the symbol.
            @content_block.progresses.update_all(
              video_last_position: 0,
              video_total_watched: 0,
              video_duration: nil,
              status: Progress.statuses[:not_started],
              completed_at: nil,
              updated_at: Time.current
            )
          end
        end
        return if performed?

        # S3 deletion is intentionally outside the transaction: rolling back a
        # successful S3 DELETE is not possible, and a failed delete shouldn't
        # block the DB update. Worst case we leak the old object, which the
        # uploads#abandon flow can clean up later.
        if old_s3_key.present? && @content_block.s3_video_key != old_s3_key
          S3Service.delete_object(old_s3_key) if S3Service.configured?
        end
        render json: { content_block: block_json(@content_block) }
      end

      # DELETE /api/v1/content_blocks/:id
      def destroy
        key_to_delete = @content_block.s3_video_key
        @content_block.destroy!
        S3Service.delete_object(key_to_delete) if key_to_delete.present? && S3Service.configured?
        head :no_content
      rescue ActiveRecord::RecordNotDestroyed
        render json: { error: "Failed to delete content block" }, status: :unprocessable_entity
      end

      # POST /api/v1/video_presign — generic presign (staff only, no content block needed)
      def generic_video_presign
        require_admin!
        return if performed?

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

        url = S3Service.generate_presigned_url(@content_block.s3_video_key, expires_in: 7200)
        progress = current_user.progresses.find_by(content_block: @content_block)

        render json: {
          stream_url: url,
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
        # Refuse progress writes against blocks that aren't backed by an S3
        # video. Without this, an enrolled student could call this endpoint on
        # a text or code block and write through to its s3_video_duration_seconds
        # via the first-reporter lock below, corrupting the authoritative
        # duration the moment a real video is later attached.
        unless @content_block.s3_video_key.present?
          render json: { error: "Content block has no video to track" }, status: :unprocessable_entity
          return
        end

        # Lock the authoritative duration on the content block once. The first reporter
        # sets it; staff can override via update_content_block. This prevents per-user
        # completion fabrication via tiny client-reported durations.
        #
        # Capture the resolved duration into a local *before* writing it via update_column,
        # because update_column bypasses model callbacks and does not refresh the in-memory
        # @content_block — without this, the very next read would still be nil and the 90%
        # completion check below would be silently skipped on the first-ever ping.
        authoritative_duration = @content_block.s3_video_duration_seconds
        if authoritative_duration.blank? && params[:duration_seconds].to_i.positive?
          authoritative_duration = params[:duration_seconds].to_i
          @content_block.update_column(:s3_video_duration_seconds, authoritative_duration)
        end

        # find_or_initialize_by + save races against the unique index
        # index_progresses_on_user_id_and_content_block_id when the player
        # fires its first progress ping concurrently with another tab or with
        # the lesson view that lazily creates a not_started row. The second
        # save would raise ActiveRecord::RecordNotUnique → unrescued 500. Try
        # once, and on collision re-fetch the row the racing request inserted
        # and merge our update into it.
        progress = upsert_video_progress(authoritative_duration)
        if progress.save
          render_video_progress(progress)
        else
          render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
        end
      rescue ActiveRecord::RecordNotUnique
        progress = upsert_video_progress(authoritative_duration, force_existing: true)
        if progress.save
          render_video_progress(progress)
        else
          render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      # Apply the param-derived video progress fields (last_position, capped
      # total_watched, status transitions). Pass force_existing: true after a
      # uniqueness collision to skip the build path and merge into the row the
      # racing request just inserted instead of stacking another insert.
      def upsert_video_progress(authoritative_duration, force_existing: false)
        progress = if force_existing
          current_user.progresses.find_by!(content_block: @content_block)
        else
          current_user.progresses.find_or_initialize_by(content_block: @content_block)
        end

        progress.video_last_position = params[:last_position_seconds].to_i
        progress.video_duration = authoritative_duration if authoritative_duration.present?

        new_watched = params[:total_watched_seconds].to_i
        if authoritative_duration&.positive?
          new_watched = [ new_watched, authoritative_duration ].min
        end
        progress.video_total_watched = [ progress.video_total_watched, new_watched ].max

        if authoritative_duration&.positive? && progress.video_total_watched >= (authoritative_duration * 0.9)
          progress.status = :completed unless progress.completed?
        elsif progress.not_started?
          progress.status = :in_progress
        end
        progress
      end

      def render_video_progress(progress)
        render json: {
          video_progress: {
            content_block_id: progress.content_block_id,
            last_position: progress.video_last_position,
            total_watched: progress.video_total_watched,
            duration: progress.video_duration,
            status: progress.status,
            completed: progress.completed?
          }
        }
      end

      def set_lesson
        @lesson = Lesson.find(params[:lesson_id])
      end

      def set_content_block
        @content_block = ContentBlock.find(params[:id])
      end

      def authorize_video_access!
        authorize_content_block_write!(@content_block)
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
        return if current_user.staff?

        lesson = @content_block.lesson
        enrolled = current_user.enrollments
          .active
          .joins(:cohort)
          .exists?(cohorts: { curriculum_id: lesson.curriculum_module.curriculum_id })

        render_forbidden("Not enrolled in this curriculum") unless enrolled
      end

      def block_params
        params.permit(:block_type, :position, :title, :body, :video_url, :solution, :filename, :metadata,
                       :s3_video_key, :s3_video_content_type, :s3_video_size, :s3_video_duration_seconds)
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
          metadata: cb.metadata,
          s3_video_key: cb.s3_video_key,
          s3_video_content_type: cb.s3_video_content_type,
          s3_video_size: cb.s3_video_size,
          # Surface the authoritative server-side duration so the editor can show
          # it without round-tripping through video_stream / video_progress.
          s3_video_duration_seconds: cb.s3_video_duration_seconds
        }
      end
    end
  end
end
