require "ipaddr"

class CohortFile < ApplicationRecord
  MAX_FILE_SIZE = 100.megabytes
  DOWNLOAD_EXPIRY = 5.minutes.to_i
  VISIBILITIES = %w[students staff_only].freeze
  # "doc" is reserved for in-app documents; the API creates files and links.
  KINDS = %w[file link doc].freeze
  MAX_URL_LENGTH = 2048
  # Inline previews read at most this much of a text file.
  TEXT_PREVIEW_BYTES = 512.kilobytes

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
  # How each type previews in the app. Media is served inline from storage
  # with its allowlisted type; text is read by the API and returned as text.
  # Pages, SVGs, scripts and XML are never allowed, so never served inline.
  PREVIEW_MODES = {
    "pdf" => "pdf", "png" => "image", "jpg" => "image", "jpeg" => "image", "webp" => "image",
    "mp3" => "audio", "m4a" => "audio", "mp4" => "video",
    "md" => "markdown", "txt" => "text", "csv" => "csv"
  }.freeze
  INLINE_PREVIEW_MODES = %w[pdf image audio video].freeze
  TEXT_PREVIEW_MODES = %w[markdown text csv].freeze
  # Host (and optional path prefix) => provider, checked in order.
  LINK_PROVIDERS = [
    [ "docs.google.com", "/document/", "google_doc" ],
    [ "docs.google.com", "/spreadsheets/", "google_sheet" ],
    [ "docs.google.com", "/presentation/", "google_slides" ],
    [ "docs.google.com", nil, "google_drive" ],
    [ "drive.google.com", nil, "google_drive" ],
    [ "figma.com", nil, "figma" ],
    [ "notion.so", nil, "notion" ],
    [ "notion.site", nil, "notion" ],
    [ "canva.com", nil, "canva" ],
    [ "loom.com", nil, "loom" ],
    [ "github.com", nil, "github" ]
  ].freeze
  # Markup a browser would run or render, refused inside text uploads.
  ACTIVE_MARKUP = /<!doctype\s+html|<html|<svg|<script/i

  belongs_to :cohort
  belongs_to :student, class_name: "User", optional: true
  belongs_to :uploaded_by, class_name: "User", optional: true
  belongs_to :source_file, class_name: "CohortFile", optional: true
  # Collected before the rows go, then removed after the deletion commits.
  before_destroy :collect_stored_keys, prepend: true
  has_many :versions, class_name: "CohortFileVersion", dependent: :delete_all

  scope :ready, -> { where(ready: true) }
  scope :class_files, -> { where(student_id: nil) }
  scope :student_visible, -> { where(visibility: "students") }

  before_validation :normalize_text
  before_validation :classify_link
  before_save :record_ready_date
  before_save :record_shared_date
  after_destroy_commit :delete_stored_objects

  # Set when a caller has already removed this file's objects (and reported
  # any failure) before destroying the row.
  attr_accessor :storage_cleaned
  # Set when only the staging upload should be removed after destroy.

  validates :title, presence: true, length: { maximum: 160 }
  validates :folder, presence: true, length: { maximum: 80 }
  validates :description, length: { maximum: 500 }
  validates :visibility, inclusion: { in: VISIBILITIES }
  validates :kind, inclusion: { in: KINDS }
  validates :version_number, numericality: { only_integer: true, greater_than: 0 }
  with_options if: :stored_file? do
    validates :filename, presence: true, length: { maximum: 180 }
    validates :file_size, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: MAX_FILE_SIZE }
    validates :s3_key, :upload_key, :upload_expires_at, :content_type, presence: true
    validate :allowed_file_type
  end
  validates :external_url, absence: true, unless: :link?
  validate :safe_external_url, if: :link?
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

  # How a file previews in the app, or nil for anything without stored bytes.
  def self.preview_mode_for(filename)
    return nil if filename.blank?

    PREVIEW_MODES.fetch(extension_for(filename), "download_only")
  end

  def self.previewable_mode?(mode)
    mode.present? && mode != "download_only"
  end

  # The reason a link can't be saved, or nil. Only public https:// addresses:
  # no other scheme, credentials, local or private hosts, or bare names.
  def self.link_problem(url)
    url = url.to_s
    return "can't be blank" if url.blank?
    return "is too long (maximum is #{MAX_URL_LENGTH} characters)" if url.length > MAX_URL_LENGTH
    return "must be a web address without spaces" if url.match?(/[\s\p{Cc}]/)

    uri = URI.parse(url)
    return "must start with https://" unless uri.is_a?(URI::HTTPS) && url.downcase.start_with?("https://")

    host = uri.hostname.to_s.downcase.delete_suffix(".")
    return "must include a website address" if host.blank?
    return "can't include a username or password" if uri.userinfo.present?
    return "must be a public website" if private_host?(host)

    nil
  rescue URI::InvalidURIError
    "is not a valid web address"
  end

  def self.private_host?(host)
    return true if host == "localhost" || host.end_with?(".localhost", ".local", ".internal")

    address = IPAddr.new(host)
    address.loopback? || address.private? || address.link_local? || address.to_i.zero? ||
      (address.ipv4? && address.to_s.start_with?("0.", "100.64.", "169.254.")) || (address.ipv6? && address.ipv4_mapped? && private_host?(address.native.to_s))
  rescue IPAddr::InvalidAddressError
    # Not an IP literal: a public name needs a dot, and an all-numeric name is an encoded address.
    !host.include?(".") || host.match?(/\A[\d.]+\z/) || host.match?(/\A0x/i)
  end

  def self.link_provider_for(url)
    uri = URI.parse(url.to_s)
    host = uri.hostname.to_s.downcase.delete_prefix("www.")
    path = uri.path.to_s
    LINK_PROVIDERS.each do |domain, prefix, provider|
      next unless host == domain || host.end_with?(".#{domain}")
      return provider if prefix.nil? || path.start_with?(prefix)
    end
    "web"
  rescue URI::InvalidURIError
    "web"
  end

  # Pending uploads whose presigned POST expired can never be published.
  # Each row is rechecked under the same lock `complete` takes, so a publish
  # that commits first is kept. Once the unready row is destroyed, both
  # upload_key and s3_key are cleaned up so a destination object left by a
  # timed-out or rolled-back `complete` copy is never orphaned. Expired
  # pending versions of files in the same scope are purged the same way.
  def self.purge_expired_pending!(scope = all, now: Time.current, limit: 50)
    CohortFileVersion.purge_expired_pending!(CohortFileVersion.where(cohort_file_id: scope.select(:id)), now: now, limit: limit)
    scope.where(ready: false).where(upload_expires_at: ...now).limit(limit).pluck(:id).each do |id|
      file = find_by(id: id)
      next unless file

      file.with_lock do
        next if file.ready? || file.upload_expires_at >= now

        file.destroy!
      end
    end
  end

  def class_file?
    student_id.nil?
  end

  def stored_file?
    kind == "file"
  end

  def link?
    kind == "link"
  end

  def preview_mode
    stored_file? ? self.class.preview_mode_for(filename) : nil
  end

  def staff_only?
    visibility == "staff_only"
  end

  def uploaded_by_student?
    uploaded_by.present? && uploaded_by.student?
  end

  # Every object this file and its versions point at, staging uploads first
  # and the current object last.
  def stored_keys
    keys = versions.order(:version_number).pluck(:upload_key, :s3_key).flatten
    older, current = [ upload_key, *keys, s3_key ].compact_blank.uniq.partition { |key| key != s3_key }
    older + current
  end

  # `shown` is the version a paused learner can read when the current one
  # was published after their pause; its file details replace the current ones.
  def file_json(can_manage: false, shown: self)
    mode = shown.preview_mode
    {
      id: id, cohort_id: cohort_id, student_id: student_id, source_file_id: source_file_id,
      kind: kind, folder: folder, visibility: visibility, title: title, description: description,
      filename: shown.filename, content_type: shown.content_type, file_size: shown.file_size,
      external_url: external_url, link_provider: link_provider, version_number: shown.version_number,
      previewable: self.class.previewable_mode?(mode), preview_mode: mode,
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
    self.external_url = external_url.to_s.strip.presence
  end

  def classify_link
    self.link_provider = link? && external_url.present? ? self.class.link_provider_for(external_url) : nil
  end

  def safe_external_url
    problem = self.class.link_problem(external_url)
    errors.add(:external_url, problem) if problem
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

  def collect_stored_keys
    @stored_keys_to_delete = stored_keys
  end

  # Runs after the deletion commits, for every key the file and its versions
  # used. A failed delete is queued for retry.
  def delete_stored_objects
    return if storage_cleaned

    Array(@stored_keys_to_delete).each { |key| S3ObjectCleanup.delete_or_enqueue(key, reason: "cohort_file_destroyed") }
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
