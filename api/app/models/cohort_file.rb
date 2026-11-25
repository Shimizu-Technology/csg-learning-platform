class CohortFile < ApplicationRecord
  MAX_FILE_SIZE = 100.megabytes
  DOWNLOAD_EXPIRY = 5.minutes.to_i
  VISIBILITIES = %w[students staff_only].freeze

  # Extension => accepted MIME types. The first is the type the file is stored
  # and served as; the others are what browsers and phones commonly report.
  ALLOWED_TYPES = {
    "pdf" => %w[application/pdf],
    "docx" => %w[application/vnd.openxmlformats-officedocument.wordprocessingml.document],
    "doc" => %w[application/msword],
    "xlsx" => %w[application/vnd.openxmlformats-officedocument.spreadsheetml.sheet],
    "xls" => %w[application/vnd.ms-excel],
    "pptx" => %w[application/vnd.openxmlformats-officedocument.presentationml.presentation],
    "ppt" => %w[application/vnd.ms-powerpoint],
    "csv" => %w[text/csv application/csv application/vnd.ms-excel text/plain],
    "txt" => %w[text/plain],
    "md" => %w[text/markdown text/x-markdown text/plain],
    "zip" => %w[application/zip application/x-zip-compressed application/x-zip],
    "png" => %w[image/png],
    "jpg" => %w[image/jpeg],
    "jpeg" => %w[image/jpeg],
    "webp" => %w[image/webp],
    "mp3" => %w[audio/mpeg audio/mp3],
    "m4a" => %w[audio/mp4 audio/x-m4a audio/m4a],
    "mp4" => %w[video/mp4]
  }.freeze
  # Types a browser could run or render as a page. Rejected even if a future
  # allowlist entry or a mislabelled upload would otherwise let one through.
  BLOCKED_EXTENSIONS = %w[html htm xhtml shtml svg svgz xml js mjs cjs jsx ts tsx php exe msi dll com scr bat cmd sh bash zsh ps1 vbs jar app dmg apk].freeze
  BLOCKED_TYPES = %w[text/html application/xhtml+xml image/svg+xml text/xml application/xml text/javascript application/javascript application/x-javascript
    application/ecmascript application/x-sh application/x-msdownload application/x-msdos-program application/java-archive].freeze
  # A client that cannot tell the type sends one of these; the extension decides.
  UNKNOWN_TYPES = [ "", "application/octet-stream", "binary/octet-stream" ].freeze
  ZIP_SIGNATURES = [ "PK\x03\x04".b, "PK\x05\x06".b, "PK\x07\x08".b ].freeze
  OLE_SIGNATURE = "\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1".b
  # Opening bytes each binary format must start with, checked on `complete`.
  SIGNATURES = {
    "pdf" => ->(bytes) { bytes.start_with?("%PDF-") },
    "zip" => ->(bytes) { ZIP_SIGNATURES.any? { |signature| bytes.start_with?(signature) } },
    "docx" => ->(bytes) { ZIP_SIGNATURES.any? { |signature| bytes.start_with?(signature) } },
    "xlsx" => ->(bytes) { ZIP_SIGNATURES.any? { |signature| bytes.start_with?(signature) } },
    "pptx" => ->(bytes) { ZIP_SIGNATURES.any? { |signature| bytes.start_with?(signature) } },
    "doc" => ->(bytes) { bytes.start_with?(OLE_SIGNATURE) },
    "xls" => ->(bytes) { bytes.start_with?(OLE_SIGNATURE) },
    "ppt" => ->(bytes) { bytes.start_with?(OLE_SIGNATURE) },
    "png" => ->(bytes) { bytes.start_with?("\x89PNG\r\n\x1A\n".b) },
    "jpg" => ->(bytes) { bytes.start_with?("\xFF\xD8\xFF".b) },
    "jpeg" => ->(bytes) { bytes.start_with?("\xFF\xD8\xFF".b) },
    "webp" => ->(bytes) { bytes.start_with?("RIFF") && bytes.byteslice(8, 4) == "WEBP" },
    "mp4" => ->(bytes) { bytes.byteslice(4, 4) == "ftyp" },
    "m4a" => ->(bytes) { bytes.byteslice(4, 4) == "ftyp" },
    "mp3" => ->(bytes) { bytes.start_with?("ID3") || (bytes.getbyte(0) == 0xFF && bytes.getbyte(1).to_i & 0xE0 == 0xE0) }
  }.freeze
  TEXT_EXTENSIONS = %w[txt md csv].freeze
  # Markup a browser would run or render, refused inside text uploads.
  ACTIVE_MARKUP = /<!doctype\s+html|<html|<svg|<script/i

  belongs_to :cohort
  belongs_to :student, class_name: "User", optional: true
  belongs_to :uploaded_by, class_name: "User", optional: true
  belongs_to :source_file, class_name: "CohortFile", optional: true

  scope :ready, -> { where(ready: true) }
  scope :class_files, -> { where(student_id: nil) }
  scope :student_visible, -> { where(visibility: "students") }

  before_validation :normalize_text
  before_save :record_ready_date
  before_save :record_shared_date
  after_destroy_commit :delete_stored_objects

  # Set when a caller has already removed this file's objects (and reported
  # any failure) before destroying the row.
  attr_accessor :storage_cleaned

  validates :title, presence: true, length: { maximum: 160 }
  validates :folder, presence: true, length: { maximum: 80 }
  validates :description, length: { maximum: 500 }
  validates :visibility, inclusion: { in: VISIBILITIES }
  validates :filename, presence: true, length: { maximum: 180 }
  validates :file_size, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: MAX_FILE_SIZE }
  validates :s3_key, :upload_key, :upload_expires_at, :content_type, presence: true
  validate :allowed_file_type
  validate :student_enrolled_in_cohort
  validate :students_cannot_stage_files

  # Replace anything outside letters, digits, dot, dash and underscore. Returns
  # nil for names that are only dots or underscores, hidden, or contain "..".
  def self.sanitize_filename(name)
    clean = File.basename(name.to_s.strip).gsub(/[^a-zA-Z0-9._-]/, "_")
    return nil if clean.blank? || clean.start_with?(".") || clean.include?("..") || clean.match?(/\A[._-]*\z/)

    extension = File.extname(clean)
    return clean if clean.length <= 180

    "#{File.basename(clean, extension)[0, 180 - extension.length]}#{extension}"
  end

  def self.extension_for(filename)
    File.extname(filename.to_s).delete_prefix(".").downcase
  end

  # The stored type for an allowed filename and declared type, or nil.
  def self.normalized_content_type(filename, declared)
    extension = extension_for(filename)
    declared = declared.to_s.split(";").first.to_s.strip.downcase
    return nil if BLOCKED_EXTENSIONS.include?(extension) || BLOCKED_TYPES.include?(declared)

    accepted = ALLOWED_TYPES[extension]
    return nil unless accepted && (UNKNOWN_TYPES.include?(declared) || accepted.include?(declared))

    accepted.first
  end

  # Whether an object's first bytes match its extension. Text formats must
  # not hold null bytes or page/script markup.
  def self.content_matches?(filename, prefix)
    return false if prefix.blank?

    bytes = prefix.b
    extension = extension_for(filename)
    if TEXT_EXTENSIONS.include?(extension)
      !bytes.include?("\x00") && !bytes.force_encoding(Encoding::UTF_8).scrub.match?(ACTIVE_MARKUP)
    else
      SIGNATURES[extension]&.call(bytes) || false
    end
  end

  # Pending uploads whose presigned POST expired can never be published.
  def self.purge_expired_pending!(scope = all, now: Time.current, limit: 50)
    scope.where(ready: false).where(upload_expires_at: ...now).limit(limit).each(&:destroy!)
  end

  def class_file?
    student_id.nil?
  end

  def staff_only?
    visibility == "staff_only"
  end

  def uploaded_by_student?
    uploaded_by.present? && uploaded_by.student?
  end

  def file_json(can_manage: false)
    {
      id: id, cohort_id: cohort_id, student_id: student_id, source_file_id: source_file_id,
      folder: folder, visibility: visibility, title: title, description: description,
      filename: filename, content_type: content_type, file_size: file_size,
      ready: ready?, ready_at: ready_at&.iso8601, created_at: created_at.iso8601,
      uploaded_by_name: uploaded_by&.full_name,
      uploaded_by_role: uploaded_by && (uploaded_by.student? ? "student" : "staff"),
      can_manage: can_manage
    }
  end

  private

  def normalize_text
    self.title = title.to_s.squish.presence
    self.folder = folder.to_s.squish.presence || "General"
    self.description = description.to_s.strip.presence
  end

  def record_ready_date
    self.ready_at = Time.current if ready? && (will_save_change_to_ready? || ready_at.nil?)
  end

  # Students can see a file from the moment it is ready and visible to them.
  # Sharing a staged file starts that moment over; staging clears it.
  def record_shared_date
    if staff_only? || !ready?
      self.shared_at = nil
    elsif shared_at.nil? || will_save_change_to_visibility?
      self.shared_at = Time.current
    end
  end

  def delete_stored_objects
    return if storage_cleaned

    [ upload_key, s3_key ].each do |key|
      next if S3ObjectCleanup.delete_if_unreferenced(key)

      Rails.logger.warn("[CohortFiles] stored_object_cleanup_failed file_id=#{id}")
    end
  end

  def allowed_file_type
    if filename.present? && self.class.sanitize_filename(filename) != filename
      errors.add(:filename, "must use letters, numbers, dots, dashes or underscores")
    elsif filename.present? && self.class.normalized_content_type(filename, content_type) != content_type
      errors.add(:filename, "is not an allowed file type")
    end
  end

  def student_enrolled_in_cohort
    return if student_id.nil? || cohort_id.nil?

    errors.add(:student, "is not enrolled in this cohort") unless Enrollment.exists?(cohort_id: cohort_id, user_id: student_id)
  end

  def students_cannot_stage_files
    errors.add(:visibility, "must be visible to students for student uploads") if uploaded_by&.student? && visibility != "students"
  end
end
