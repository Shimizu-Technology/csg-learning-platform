# The rules a folder item (an upload, a link or a Learn Doc) follows wherever
# it lives: a cohort's files (CohortFile) or a curriculum's template files
# (CurriculumFile). Allowed types, the https:// link check and the Markdown
# check are CohortFile's class methods, so both tables accept exactly the
# same things.
module CabinetItem
  extend ActiveSupport::Concern

  included do
    before_validation :normalize_text
    before_validation :classify_link
    before_save :record_ready_date

    validates :title, presence: true, length: { maximum: 160 }
    validates :folder, presence: true, length: { maximum: 80 }
    validates :description, length: { maximum: 500 }
    validates :visibility, inclusion: { in: CohortFile::VISIBILITIES }
    validates :kind, inclusion: { in: CohortFile::KINDS }
    with_options if: :stored_file? do
      validates :filename, presence: true, length: { maximum: 180 }
      validates :file_size, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: CohortFile::MAX_FILE_SIZE }
      validates :s3_key, :upload_key, :upload_expires_at, :content_type, presence: true
      validate :allowed_file_type
    end
    validates :external_url, absence: true, unless: :link?
    validates :doc_content, absence: true, unless: :doc?
    validate :safe_doc_content, if: :doc?
    validate :safe_external_url, if: :link?
    validate :auto_copy_shared_with_students
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

  def staff_only?
    visibility == "staff_only"
  end

  def preview_mode
    stored_file? ? CohortFile.preview_mode_for(filename) : nil
  end

  private

  def normalize_text
    self.title = title.to_s.squish.presence
    self.folder = folder.to_s.squish.presence || "General"
    self.description = description.to_s.strip.presence
    self.external_url = external_url.to_s.strip.presence
    self.doc_content = doc? ? doc_content.to_s : nil
  end

  def classify_link
    self.link_provider = link? && external_url.present? ? CohortFile.link_provider_for(external_url) : nil
  end

  def record_ready_date
    self.ready_at = Time.current if ready? && (will_save_change_to_ready? || ready_at.nil?)
  end

  # Markdown only: no null bytes, and no page or script markup outside code.
  def safe_doc_content
    content = doc_content.to_s
    if content.length > CohortFile::MAX_DOC_LENGTH
      errors.add(:doc_content, "is too long (maximum is #{CohortFile::MAX_DOC_LENGTH} characters)")
    elsif content.include?("\u0000")
      errors.add(:doc_content, "can't contain null characters")
    elsif CohortFile.active_markup_outside_code?(content)
      errors.add(:doc_content, "can't contain page or script markup outside code blocks")
    end
  end

  def safe_external_url
    problem = CohortFile.link_problem(external_url)
    errors.add(:external_url, problem) if problem
  end

  def allowed_file_type
    if filename.present? && CohortFile.sanitize_filename(filename) != filename
      errors.add(:filename, "must use letters, numbers, dots, dashes or underscores")
    elsif filename.present? && CohortFile.normalized_content_type(filename, content_type) != content_type
      errors.add(:filename, "is not an allowed file type")
    end
  end

  # Only an item students can already see is copied into their folders.
  def auto_copy_shared_with_students
    errors.add(:auto_copy_to_students, "needs the item shared with students first") if auto_copy_to_students? && staff_only?
  end
end
