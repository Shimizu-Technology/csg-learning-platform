module Api
  module V1
    # Best-effort cleanup for objects that landed in S3 but never got
    # associated with a DB row (e.g. presign + PUT succeeded but the
    # subsequent createRecording / updateContentBlock failed). The frontend
    # calls this from its upload-error path so we don't leak orphaned
    # objects in the bucket.
    class UploadsController < ApplicationController
      before_action :authenticate_user!
      before_action :require_staff!

      ALLOWED_PREFIXES = [ "recordings/", "content_videos/" ].freeze
      MAX_MULTIPART_PARTS = 10_000

      # DELETE /api/v1/uploads/abandon
      def abandon
        key = params[:s3_key].to_s
        return head :bad_request if key.blank?

        # Constrain to our managed namespaces so a forged payload can't be
        # used to delete arbitrary objects from the bucket.
        unless ALLOWED_PREFIXES.any? { |p| key.start_with?(p) }
          render json: { error: "Invalid s3_key" }, status: :bad_request
          return
        end

        # Refuse if the key is still referenced by a live row — that's not an
        # orphan, that's the canonical attachment for some recording or
        # content block, and silently deleting it would break playback.
        if Recording.exists?(s3_key: key) || ContentBlock.exists?(s3_video_key: key)
          render json: { error: "S3 key is still referenced by a row" }, status: :unprocessable_entity
          return
        end

        S3Service.delete_object(key) if S3Service.configured?
        head :no_content
      end

      # POST /api/v1/uploads/multipart/initiate
      def multipart_initiate
        return render_s3_unavailable unless S3Service.configured?

        content_type = validated_video_content_type(params[:content_type] || "video/mp4")
        return if content_type.nil?
        return unless validate_multipart_file_size!
        return if admin_only_multipart_target? && !authorize_admin_multipart_target!

        key = build_multipart_key
        return if performed?

        upload_id = S3Service.create_multipart_upload(key, content_type)
        render json: { s3_key: key, upload_id: upload_id }
      end

      # POST /api/v1/uploads/multipart/part_url
      def multipart_part_url
        return render_s3_unavailable unless S3Service.configured?
        return unless validate_multipart_key!

        part_number = params[:part_number].to_i
        unless part_number.between?(1, MAX_MULTIPART_PARTS)
          render json: { error: "part_number must be between 1 and #{MAX_MULTIPART_PARTS}" }, status: :unprocessable_entity
          return
        end

        upload_id = params[:upload_id].to_s
        if upload_id.blank?
          render json: { error: "upload_id is required" }, status: :bad_request
          return
        end

        render json: {
          upload_url: S3Service.generate_presigned_upload_part_url(params[:s3_key], upload_id, part_number)
        }
      end

      # POST /api/v1/uploads/multipart/complete
      def multipart_complete
        return render_s3_unavailable unless S3Service.configured?
        return unless validate_multipart_key!

        upload_id = params[:upload_id].to_s
        parts = normalize_multipart_parts(params[:parts])

        if upload_id.blank? || parts.empty?
          render json: { error: "upload_id and parts are required" }, status: :bad_request
          return
        end

        S3Service.complete_multipart_upload(params[:s3_key], upload_id, parts)
        head :no_content
      end

      # DELETE /api/v1/uploads/multipart/abort
      def multipart_abort
        return render_s3_unavailable unless S3Service.configured?
        return unless validate_multipart_key!

        upload_id = params[:upload_id].to_s
        if upload_id.blank?
          render json: { error: "upload_id is required" }, status: :bad_request
          return
        end

        S3Service.abort_multipart_upload(params[:s3_key], upload_id)
        head :no_content
      end

      private

      def render_s3_unavailable
        render json: { error: "S3 not configured" }, status: :service_unavailable
      end

      def validate_multipart_key!
        key = params[:s3_key].to_s
        if key.blank?
          render json: { error: "s3_key is required" }, status: :bad_request
          return false
        end

        unless ALLOWED_PREFIXES.any? { |prefix| key.start_with?(prefix) }
          render json: { error: "Invalid s3_key" }, status: :bad_request
          return false
        end

        true
      end

      def build_multipart_key
        filename = params[:filename]
        safe_name = filename.to_s.gsub(/[^a-zA-Z0-9._-]/, "_")
        safe_name = "video.mp4" if safe_name.blank?
        timestamp = Time.current.strftime("%Y%m%d%H%M%S")

        if params[:cohort_id].present?
          cohort = Cohort.find(params[:cohort_id])
          return "recordings/cohort_#{cohort.id}/#{timestamp}_#{SecureRandom.hex(4)}_#{safe_name}"
        end

        if params[:content_block_id].present?
          content_block = ContentBlock.find(params[:content_block_id])
          return "content_videos/block_#{content_block.id}/#{timestamp}_#{safe_name}"
        end

        "content_videos/#{SecureRandom.uuid}/#{safe_name}"
      rescue ActiveRecord::RecordNotFound
        render json: { error: "Upload target not found" }, status: :not_found
        nil
      end

      def validate_multipart_file_size!
        file_size = params[:file_size].to_i
        if file_size <= 0
          render json: { error: "file_size is required" }, status: :bad_request
          return false
        end

        if file_size > S3Service::MAX_UPLOAD_SIZE
          render json: { error: "file_size must be 5 GB or smaller" }, status: :unprocessable_entity
          return false
        end

        true
      end

      def admin_only_multipart_target?
        params[:cohort_id].blank?
      end

      def authorize_admin_multipart_target!
        return true if current_user&.admin?

        render_forbidden("Admin access required")
        false
      end

      def normalize_multipart_parts(raw_parts)
        Array(raw_parts).filter_map do |raw_part|
          part = raw_part.respond_to?(:to_unsafe_h) ? raw_part.to_unsafe_h : raw_part.to_h
          part_number = part["part_number"] || part[:part_number]
          etag = part["etag"] || part[:etag]
          next if part_number.blank? || etag.blank?

          { part_number: part_number.to_i, etag: etag.to_s }
        rescue NoMethodError
          nil
        end
      end
    end
  end
end
