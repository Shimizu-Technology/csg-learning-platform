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
    end
  end
end
