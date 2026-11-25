class S3ObjectCleanup
  MANAGED_KEY_PATTERNS = [
    %r{\Arecordings/cohort_\d+/\d{14}_[0-9a-f]{8}_[^/]+\z},
    %r{\Acontent_videos/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\z},
    %r{\Acontent_videos/block_\d+/\d{14}_[^/]+\z},
    %r{\Acohort_files/cohort_\d+/(?:shared|student_\d+)/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\z},
    %r{\Acohort_file_uploads/cohort_\d+/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+\z}
  ].freeze

  class << self
    def delete_if_unreferenced(key)
      delete_unreferenced(key).in?(%i[deleted skipped])
    end

    # :deleted, :skipped (blank key or no storage configured), :referenced
    # (still in use), :rejected (not a managed key) or :failed.
    def delete_unreferenced(key)
      return :skipped if key.blank?
      unless managed_key?(key)
        Rails.logger.warn("[S3ObjectCleanup] Rejected unmanaged object key: #{key}")
        return :rejected
      end
      return :skipped unless S3Service.configured?

      with_key_lock(key) do
        next :referenced if referenced?(key)

        S3Service.delete_object(key) ? :deleted : :failed
      end
    rescue StandardError => error
      Rails.logger.error("[S3ObjectCleanup] Failed to delete #{key}: #{error.class}: #{error.message}")
      :failed
    end

    # Deletes an unreferenced object now, or queues a durable retry when
    # storage fails. Returns the delete_unreferenced status.
    def delete_or_enqueue(key, reason:)
      status = delete_unreferenced(key)
      PendingS3Deletion.enqueue!(key, reason: reason) if status == :failed
      status
    end

    # Checks a new attachment key in storage before the caller takes any row
    # locks, inside the transaction that will save the reference. The key's
    # advisory lock is held from here until that transaction commits, so a
    # concurrent delete_if_unreferenced either finished before this check or
    # waits and then sees the new reference. Returns nil when the key can be
    # attached, or the problem ("was not found in storage").
    def verify_attachment(key)
      key = key.to_s
      return nil if key.blank?
      return "is not a managed video object" unless managed_key?(key)
      return nil unless S3Service.configured?
      raise ArgumentError, "verify_attachment must run inside the saving transaction" unless ApplicationRecord.connection.transaction_open?

      with_key_lock(key) do
        S3Service.object_exists?(key) ? nil : "was not found in storage"
      end
    rescue ArgumentError
      raise
    rescue StandardError => error
      Rails.logger.error("[S3ObjectCleanup] Failed to verify #{key}: #{error.class}: #{error.message}")
      "could not be verified in storage"
    end

    # verified_key: the same key already passed verify_attachment earlier in
    # this transaction, so storage isn't asked again (cheap re-check only).
    def validate_attachment(record, attribute, verified_key: nil)
      key = record.public_send(attribute).to_s
      return if key.blank?

      unless managed_key?(key)
        record.errors.add(attribute, "is not a managed video object")
        return
      end
      return unless S3Service.configured?
      return if verified_key.present? && verified_key.to_s == key && ApplicationRecord.connection.transaction_open?

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
      Recording.exists?(s3_key: key) || ContentBlock.exists?(s3_video_key: key) ||
        CohortFile.exists?(s3_key: key) || CohortFile.exists?(upload_key: key) ||
        CohortFileVersion.exists?(s3_key: key) || CohortFileVersion.exists?(upload_key: key) ||
        ContentBlock.where("metadata @> ?::jsonb", { video_versions: [ { s3_video_key: key } ] }.to_json).exists?
    end
  end
end
