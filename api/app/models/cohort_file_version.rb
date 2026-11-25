# One published (or pending) version of an uploaded cohort file. The
# cohort_files row mirrors the current version; older versions keep their own
# stored objects until the file is deleted. Version 1 is archived here the
# first time a new version is started, so history always includes it.
class CohortFileVersion < ApplicationRecord
  belongs_to :cohort_file
  belongs_to :uploaded_by, class_name: "User", optional: true

  scope :ready, -> { where(ready: true) }

  before_validation :normalize_note
  before_save :record_ready_date
  after_destroy_commit :delete_stored_objects

  validates :version_number, numericality: { only_integer: true, greater_than: 0 }
  validates :filename, presence: true, length: { maximum: 180 }
  validates :file_size, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: CohortFile::MAX_FILE_SIZE }
  validates :s3_key, :upload_key, :upload_expires_at, :content_type, presence: true
  validates :note, length: { maximum: 300 }
  validate :allowed_file_type

  # Expired pending versions can never be published. Each row is rechecked
  # under the row lock `complete` takes, so a publish that commits first is
  # kept; ready versions are never touched. After the destroy commits, both
  # the staging upload and any destination object a rolled-back `complete`
  # copied are cleaned up.
  def self.purge_expired_pending!(scope = all, now: Time.current, limit: 50)
    scope.where(ready: false).where(upload_expires_at: ...now).limit(limit).pluck(:id).each do |id|
      version = find_by(id: id)
      next unless version

      version.with_lock do
        next if version.ready? || version.upload_expires_at >= now

        version.destroy!
      end
    end
  end

  def preview_mode
    CohortFile.preview_mode_for(filename)
  end

  def version_json(current:)
    {
      id: id, cohort_file_id: cohort_file_id, version_number: version_number,
      filename: filename, content_type: content_type, file_size: file_size, note: note,
      ready_at: ready_at&.iso8601, uploaded_by_name: uploaded_by&.full_name,
      current: current, preview_mode: preview_mode, previewable: CohortFile.previewable_mode?(preview_mode)
    }
  end

  private

  def normalize_note
    self.note = note.to_s.squish.presence
  end

  def record_ready_date
    self.ready_at ||= Time.current if ready?
  end

  # Runs after the deletion commits. A failed delete is queued for retry; a
  # key another row still uses is kept by S3ObjectCleanup's reference check.
  def delete_stored_objects
    return if destroyed_by_association

    [ upload_key, s3_key ].uniq.each { |key| S3ObjectCleanup.delete_or_enqueue(key, reason: "cohort_file_version_destroyed") }
  end

  def allowed_file_type
    if filename.present? && CohortFile.sanitize_filename(filename) != filename
      errors.add(:filename, "must use letters, numbers, dots, dashes or underscores")
    elsif filename.present? && CohortFile.normalized_content_type(filename, content_type) != content_type
      errors.add(:filename, "is not an allowed file type")
    end
  end
end
