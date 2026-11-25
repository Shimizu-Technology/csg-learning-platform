require "ipaddr"

class CohortFile < ApplicationRecord
  MAX_FILE_SIZE = 100.megabytes
  DOWNLOAD_EXPIRY = 5.minutes.to_i
  VISIBILITIES = %w[students staff_only].freeze
  # "doc" is a Learn Doc: Markdown written and edited in the app.
  KINDS = %w[file link doc].freeze
  # Any file in a student's folder can be sent for review; staff mark it reviewed.
  REVIEW_STATUSES = %w[none needs_review reviewed].freeze
  MAX_DOC_LENGTH = 200_000
  # One editor's saves inside this window share a revision (see save_doc!).
  DOC_REVISION_WINDOW = 10.minutes
  # Parsed as GitHub Markdown, so code (fenced, indented, inline) is found the
  # way the reader renders it; only the rest is checked for page markup.
  DOC_PARSE_OPTIONS = { extension: { table: true, tasklist: true, strikethrough: true, autolink: true } }.freeze
  # The doc state a viewer reads: the current one, or a revision for a paused
  # learner (which has no version: it can't be saved from).
  DocState = Struct.new(:title, :content, :updated_at, :updated_by_name, :version, keyword_init: true)
  MAX_URL_LENGTH = 2048
  # Links must point at a public host. Every range below is local, private,
  # shared (CGNAT), link-local, reserved, multicast or documentation-only.
  NON_PUBLIC_IPV4 = %w[0.0.0.0/8 10.0.0.0/8 100.64.0.0/10 127.0.0.0/8 169.254.0.0/16 172.16.0.0/12 192.0.0.0/24 192.0.2.0/24
    192.88.99.0/24 192.168.0.0/16 198.18.0.0/15 198.51.100.0/24 203.0.113.0/24 224.0.0.0/4 240.0.0.0/4].map { |range| IPAddr.new(range) }.freeze
  GLOBAL_IPV6 = IPAddr.new("2000::/3")
  # Local-only names, refused on their own and as a suffix.
  LOCAL_NAMES = %w[localhost local internal home.arpa].freeze
  # IANA special-purpose blocks inside 2000::/3: all of 2001::/23 (Teredo,
  # benchmarking, ORCHID and the rest), documentation, 6to4 and the newer
  # documentation block...
  NON_PUBLIC_IPV6 = %w[2001::/23 2001:db8::/32 2002::/16 3fff::/20].map { |range| IPAddr.new(range) }.freeze
  # ...except the sub-allocations IANA lists as globally reachable.
  PUBLIC_IPV6_EXCEPTIONS = %w[2001:1::1/128 2001:1::2/128 2001:1::3/128 2001:3::/32 2001:4:112::/48 2001:20::/28 2001:30::/28]
    .map { |range| IPAddr.new(range) }.freeze
  # Dotted labels of letters, digits and hyphens, ending in an alphabetic
  # (or punycode) top-level label, so bare names and numeric hosts fail.
  PUBLIC_HOSTNAME = /\A(?=.{4,253}\z)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})\z/
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
  # Locks the row, then queues every stored key in the deleting transaction,
  # before the versions go; the objects are removed after it commits.
  before_destroy :queue_stored_objects, prepend: true
  has_many :versions, class_name: "CohortFileVersion", dependent: :delete_all
  has_many :doc_revisions, class_name: "CohortDocRevision", dependent: :delete_all
  has_many :comments, class_name: "CohortFileComment", dependent: :delete_all
  has_many :notifications, as: :notifiable, dependent: :delete_all
  belongs_to :doc_updated_by, class_name: "User", optional: true
  belongs_to :reviewed_by, class_name: "User", optional: true

  scope :ready, -> { where(ready: true) }
  scope :class_files, -> { where(student_id: nil) }
  scope :student_visible, -> { where(visibility: "students") }

  before_validation :normalize_text
  before_validation :classify_link
  before_save :record_ready_date
  before_save :record_shared_date
  after_destroy_commit :delete_stored_objects

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
  validates :review_status, inclusion: { in: REVIEW_STATUSES }
  validates :doc_content, absence: true, unless: :doc?
  validate :safe_doc_content, if: :doc?
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
    url = url.to_s.dup.force_encoding(Encoding::UTF_8)
    return "is not a valid web address" unless url.valid_encoding?
    return "can't be blank" if url.blank?
    return "is too long (maximum is #{MAX_URL_LENGTH} characters)" if url.length > MAX_URL_LENGTH
    return "must be a web address without spaces" if url.match?(/[\s\p{Cc}]/)

    return "must start with https://" unless url.downcase.start_with?("https://")

    authority = url[8..].to_s[%r{\A[^/?#]*}]
    return "can't include a username or password" if authority.include?("@")
    return "must be a public website" unless authority.ascii_only? && !authority.match?(/[%\\]/)

    uri = URI.parse(url)
    return "must start with https://" unless uri.is_a?(URI::HTTPS)

    host = uri.host.to_s.downcase.delete_suffix(".")
    return "must include a website address" if host.blank?
    return "must be a public website" if private_host?(host)

    nil
  rescue URI::InvalidURIError
    "is not a valid web address"
  end

  # Whether a host is anything but a public name or public address: local
  # and internal names, single labels, encoded or ambiguous authorities, and
  # every non-public IPv4 range (IPv4-mapped IPv6 is unwrapped first). IPv6
  # literals must be global unicast (2000::/3).
  def self.private_host?(host)
    host = host.to_s.downcase.delete_prefix("[").delete_suffix("]")
    return true unless host.ascii_only? && !host.include?("%")

    address = IPAddr.new(host)
    address = address.native if address.ipv6? && address.ipv4_mapped?
    if address.ipv6?
      return true unless GLOBAL_IPV6.include?(address)

      return NON_PUBLIC_IPV6.any? { |range| range.include?(address) } && PUBLIC_IPV6_EXCEPTIONS.none? { |range| range.include?(address) }
    end

    NON_PUBLIC_IPV4.any? { |range| range.include?(address) }
  rescue IPAddr::InvalidAddressError
    return true if LOCAL_NAMES.any? { |name| host == name || host.end_with?(".#{name}") }

    !host.match?(PUBLIC_HOSTNAME)
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
    rescue ActiveRecord::RecordNotFound
      # Removed by a concurrent purge or delete; the other candidates still run.
      next
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

  def doc?
    kind == "doc"
  end

  def current_doc_state
    DocState.new(title: title, content: doc_content.to_s, updated_at: doc_updated_at || created_at, updated_by_name: doc_updated_by&.full_name, version: doc_version)
  end

  # Saves a doc edit and advances `doc_version`. Call under the doc's row
  # lock, after locking the enrollments of everyone who can read it (see
  # CohortFilesController#with_doc_lock), so a pause can't land in between.
  # Revisions are states the doc really had, stamped with when they were saved:
  # - Before the edit, the state it replaces is kept when it isn't a
  #   revision yet and was a resting point: the original (first edit), the
  #   last save of another editor, a save older than the revision window,
  #   the state a paused learner was left with, or always with `archive`
  #   (a restore or a rename never loses a saved draft).
  # - After the edit, the new state is kept on the first edit, a change of
  #   editor, when the newest revision is older than the window, and for a
  #   `checkpoint` (a named save or a restore).
  # An unchanged save is a no-op, so a repeated autosave never conflicts.
  def save_doc!(content:, editor:, title: nil, summary: nil, checkpoint: false, archive: false, now: Time.current)
    title = title.to_s.squish.presence
    return false if !checkpoint && content.to_s == doc_content.to_s && (title.nil? || title == self.title)

    latest = doc_revisions.order(:revision_number).last
    first_edit = latest.nil?
    new_editor = doc_updated_by_id != editor.id
    resting = archive || first_edit || new_editor || (doc_updated_at || created_at) <= now - DOC_REVISION_WINDOW || paused_since_last_doc_save?
    latest = record_doc_state!(latest) if resting
    assign_attributes(doc_content: content.to_s, doc_updated_at: now, doc_updated_by: editor, doc_version: doc_version + 1)
    self.title = title if title
    save!
    record_doc_state!(latest, summary: summary) if first_edit || new_editor || checkpoint || latest.created_at <= now - DOC_REVISION_WINDOW
    true
  end

  # Records the current state as the next revision unless the newest one already holds it.
  def record_doc_state!(latest = doc_revisions.order(:revision_number).last, summary: nil)
    saved_at = doc_updated_at || created_at
    return latest if latest && latest.created_at >= saved_at && latest.content == doc_content.to_s && latest.title == title

    doc_revisions.create!(revision_number: (latest&.revision_number || 0) + 1, title: title, content: doc_content.to_s,
      edited_by_id: doc_updated_by_id, summary: summary, created_at: saved_at)
  end

  # Whether Markdown holds page or script markup anywhere but code, read from
  # the parsed document: raw HTML (blocks and inline) and text (including
  # escaped or entity-written tags) are checked; code spans and blocks aren't.
  # Every other node starts a new line, so text either side of code or of a
  # block break never joins into a tag.
  def self.active_markup_outside_code?(markdown)
    text = +""
    Commonmarker.parse(markdown.to_s.dup.force_encoding(Encoding::UTF_8).scrub, options: DOC_PARSE_OPTIONS).walk do |node|
      text << if node.type == :text then node.string_content
      elsif node.type.to_s.start_with?("html") then node.to_commonmark
      else "\n"
      end
    end
    text.match?(ACTIVE_MARKUP)
  end

  # Enrollments whose learner can read this item, or could be paused into
  # reading it: the folder's student, or everyone in the cohort for a class
  # item, whatever their status (a completed enrollment can still be paused).
  def reader_enrollments
    readers = Enrollment.where(cohort_id: cohort_id)
    student_id ? readers.where(user_id: student_id) : readers
  end

  def student_folder_item?
    student_id.present? && !staff_only?
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
  # `doc_state` replaces a doc's title, save time and version the same way.
  # `review_cutoff` (a paused learner's) hides review changes made after it.
  def file_json(can_manage: false, shown: self, doc_state: nil, comment_count: 0, can_edit_doc: false, review_cutoff: nil)
    mode = shown.preview_mode
    doc_state ||= current_doc_state if doc?
    review = review_cutoff && !(review_status == "reviewed" && reviewed_at && reviewed_at <= review_cutoff) ? {} : { status: review_status, by: reviewed_by, at: reviewed_at }
    {
      id: id, cohort_id: cohort_id, student_id: student_id, source_file_id: source_file_id,
      kind: kind, folder: folder, visibility: visibility, title: doc_state&.title || title, description: description,
      filename: shown.filename, content_type: shown.content_type, file_size: shown.file_size,
      external_url: external_url, link_provider: link_provider, version_number: shown.version_number,
      previewable: self.class.previewable_mode?(mode), preview_mode: mode,
      ready: ready?, ready_at: ready_at&.iso8601, created_at: created_at.iso8601,
      uploaded_by_name: uploaded_by&.full_name,
      uploaded_by_role: uploaded_by && (uploaded_by.student? ? "student" : "staff"),
      can_manage: can_manage,
      review_status: review.fetch(:status, "none"), reviewed_by_name: review[:by]&.full_name, reviewed_at: review[:at]&.iso8601,
      comment_count: comment_count,
      doc_version: doc_state&.version, doc_updated_at: doc_state&.updated_at&.iso8601(6), doc_updated_by_name: doc_state&.updated_by_name,
      can_edit_doc: doc? && can_edit_doc
    }
  end

  private

  def normalize_text
    self.title = title.to_s.squish.presence
    self.folder = folder.to_s.squish.presence || "General"
    self.description = description.to_s.strip.presence
    self.external_url = external_url.to_s.strip.presence
    self.doc_content = doc? ? doc_content.to_s : nil
  end

  # A paused learner who can read this doc paused after its last save.
  def paused_since_last_doc_save?
    return false if doc_updated_at.nil?

    readers = Enrollment.where(cohort_id: cohort_id, status: Enrollment.statuses.fetch("paused"))
    readers = readers.where(user_id: student_id) if student_id
    readers.where("COALESCE(enrollments.paused_at, enrollments.read_cutoff_at) >= ?", doc_updated_at).exists?
  end

  # Markdown only: no null bytes, and no page or script markup outside code.
  def safe_doc_content
    content = doc_content.to_s
    if content.length > MAX_DOC_LENGTH
      errors.add(:doc_content, "is too long (maximum is #{MAX_DOC_LENGTH} characters)")
    elsif content.include?("\u0000")
      errors.add(:doc_content, "can't contain null characters")
    elsif self.class.active_markup_outside_code?(content)
      errors.add(:doc_content, "can't contain page or script markup outside code blocks")
    end
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
    elsif shared_at.nil? || will_save_change_to_visibility? || (link? && persisted? && will_save_change_to_external_url?)
      self.shared_at = Time.current
    end
  end

  # Runs inside the destroy transaction. The row lock waits out a version
  # being started or published, so the snapshot holds every key, and the
  # durable queue rows commit (or roll back) with the deletion itself.
  def queue_stored_objects
    locked = self.class.lock.find_by(id: id)
    @stored_keys_to_delete = (locked || self).stored_keys
    PendingS3Deletion.enqueue_all!(@stored_keys_to_delete, reason: "cohort_file_destroyed")
  end

  # Runs after the deletion commits: tries each queued key now and clears
  # its queue row; a failed delete stays queued for ScheduledTick to retry.
  def delete_stored_objects
    PendingS3Deletion.attempt_now!(Array(@stored_keys_to_delete))
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
