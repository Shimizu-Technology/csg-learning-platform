module Api
  module V1
    class ContentBlocksController < ApplicationController
      before_action :authenticate_user!
      before_action :require_admin!, except: [ :video_stream, :video_progress ]
      before_action :set_lesson, only: [ :index, :create ]
      before_action :set_content_block, only: [ :show, :update, :destroy, :video_presign, :video_stream, :video_progress ]
      before_action :authorize_video_access!, only: [ :video_stream, :video_progress ]

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

        if @content_block.update(block_params)
          if old_s3_key.present? && @content_block.s3_video_key != old_s3_key
            S3Service.delete_object(old_s3_key) if S3Service.configured?
          end
          render json: { content_block: block_json(@content_block) }
        else
          render json: { errors: @content_block.errors.full_messages }, status: :unprocessable_entity
        end
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

        filename = params[:filename]
        content_type = params[:content_type] || "video/mp4"
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

        filename = params[:filename]
        content_type = params[:content_type] || "video/mp4"
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

        progress = current_user.progresses.find_or_initialize_by(content_block: @content_block)
        progress.video_last_position = params[:last_position_seconds].to_i
        progress.video_duration = authoritative_duration if authoritative_duration.present?

        new_watched = params[:total_watched_seconds].to_i
        progress.video_total_watched = [ progress.video_total_watched, new_watched ].max

        # Only mark complete using the server-side authoritative duration.
        if authoritative_duration&.positive? && progress.video_total_watched >= (authoritative_duration * 0.9)
          progress.status = :completed unless progress.completed?
        elsif progress.not_started?
          progress.status = :in_progress
        end

        # Match the rest of the controllers: surface validation errors as 422
        # rather than letting RecordInvalid bubble up to a 500. This is unlikely
        # to fire on the happy path (all fields are coerced via to_i above) but
        # keeps the contract consistent for the player's polling loop.
        if progress.save
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
        else
          render json: { errors: progress.errors.full_messages }, status: :unprocessable_entity
        end
      end

      private

      def set_lesson
        @lesson = Lesson.find(params[:lesson_id])
      end

      def set_content_block
        @content_block = ContentBlock.find(params[:id])
      end

      def authorize_video_access!
        authorize_content_block_write!(@content_block)
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
