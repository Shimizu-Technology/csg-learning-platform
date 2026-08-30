class S3ObjectCleanup
  class << self
    def delete_if_unreferenced(key)
      return true if key.blank? || !S3Service.configured?
      return false if Recording.exists?(s3_key: key) || ContentBlock.exists?(s3_video_key: key)

      S3Service.delete_object(key)
    rescue StandardError => error
      Rails.logger.error("[S3ObjectCleanup] Failed to delete #{key}: #{error.class}: #{error.message}")
      false
    end
  end
end
