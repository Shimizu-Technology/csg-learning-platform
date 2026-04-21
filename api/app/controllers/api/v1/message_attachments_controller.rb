module Api
  module V1
    class MessageAttachmentsController < ApplicationController
      MAX_MESSAGE_UPLOAD_SIZE = 25.megabytes
      ALLOWED_IMAGE_TYPES = %w[image/jpeg image/png image/webp image/gif].freeze
      ALLOWED_FILE_TYPES = %w[application/pdf text/plain application/zip application/x-zip-compressed].freeze

      before_action :authenticate_user!

      # POST /api/v1/message_attachments/presign
      def presign
        unless S3Service.configured?
          render json: { error: "S3 uploads are not configured" }, status: :service_unavailable
          return
        end

        destination = upload_destination
        return if performed?

        unless destination.can_post?(current_user)
          render_forbidden("Cannot upload to this conversation")
          return
        end

        content_type = params[:content_type].to_s.strip.downcase
        unless allowed_content_type?(content_type)
          render json: { error: "content_type is not allowed for message attachments" }, status: :unprocessable_entity
          return
        end

        filename = params[:filename].to_s.presence || "attachment"
        key = attachment_key(destination, filename)
        post = S3Service.generate_presigned_post(key, content_type, max_size: MAX_MESSAGE_UPLOAD_SIZE)

        render json: {
          upload_url: post.url,
          fields: post.fields,
          s3_key: key,
          max_size: MAX_MESSAGE_UPLOAD_SIZE
        }
      end

      private

      def upload_destination
        if params[:channel_id].present?
          Channel.find(params[:channel_id])
        elsif params[:direct_conversation_id].present?
          DirectConversation.find(params[:direct_conversation_id])
        else
          render json: { error: "channel_id or direct_conversation_id is required" }, status: :unprocessable_entity
          nil
        end
      end

      def attachment_key(destination, filename)
        safe_name = filename.gsub(/[^a-zA-Z0-9.\-_]/, "_")
        folder = destination.is_a?(Channel) ? "channel_#{destination.id}" : "dm_#{destination.id}"
        "message_attachments/#{folder}/#{SecureRandom.uuid}/#{safe_name}"
      end

      def allowed_content_type?(content_type)
        ALLOWED_IMAGE_TYPES.include?(content_type) || ALLOWED_FILE_TYPES.include?(content_type)
      end
    end
  end
end
