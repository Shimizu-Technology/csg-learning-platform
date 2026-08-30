class S3ObjectCleanup
  MANAGED_KEY_PATTERNS = [
    %r{\Arecordings/cohort_\d+/\d{14}_[0-9a-f]{8}_[^/]+\z},
    %r{\Acontent_videos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\z},
    %r{\Acontent_videos/block_\d+/\d{14}_[^/]+\z}
  ].freeze

  class << self
    def delete_if_unreferenced(key)
      return true if key.blank?
      unless managed_key?(key)
        Rails.logger.warn("[S3ObjectCleanup] Rejected unmanaged object key: #{key}")
        return false
      end
      return true unless S3Service.configured?

      with_key_lock(key) do
        referenced?(key) ? false : S3Service.delete_object(key)
      end
    rescue StandardError => error
      Rails.logger.error("[S3ObjectCleanup] Failed to delete #{key}: #{error.class}: #{error.message}")
      false
    end

    def validate_attachment(record, attribute)
      key = record.public_send(attribute).to_s
      return if key.blank?

      unless managed_key?(key)
        record.errors.add(attribute, "is not a managed video object")
        return
      end
      return unless S3Service.configured?

      with_key_lock(key) do
        record.errors.add(attribute, "was not found in storage") unless S3Service.object_exists?(key)
      end
    rescue StandardError => error
      Rails.logger.error("[S3ObjectCleanup] Failed to validate #{key}: #{error.class}: #{error.message}")
      record.errors.add(attribute, "could not be verified in storage")
    end

    def managed_key?(key)
      MANAGED_KEY_PATTERNS.any? { |pattern| pattern.match?(key.to_s) }
    end

    def with_key_lock(key)
      ApplicationRecord.transaction do
        connection = ApplicationRecord.connection
        quoted_key = connection.quote(key.to_s)
        # Attachment validation and deletion share this transaction-scoped
        # lock. Whichever arrives second must re-check storage/references after
        # the first transaction commits, so a new row cannot race an S3 delete.
        connection.execute("SELECT pg_advisory_xact_lock(hashtextextended(#{quoted_key}, 0))")
        yield
      end
    end

    private

    def referenced?(key)
      Recording.exists?(s3_key: key) || ContentBlock.exists?(s3_video_key: key)
    end
  end
end
