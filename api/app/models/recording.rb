class Recording < ApplicationRecord
  SOURCE_KINDS = %w[uploaded youtube vimeo loom direct external].freeze

  belongs_to :cohort
  belongs_to :uploaded_by, class_name: "User", optional: true
  has_many :watch_progresses, dependent: :destroy

  enum :status, { draft: 0, published: 1 }, default: :draft, validate: true

  validates :title, presence: true
  validates :source_kind, inclusion: { in: SOURCE_KINDS }
  validates :s3_key, presence: true, uniqueness: true, if: :uploaded?
  validates :content_type, presence: true, if: :uploaded?
  validates :file_size, presence: true, numericality: { greater_than: 0 }, if: :uploaded?
  validates :source_url, presence: true, unless: :uploaded?
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :source_url_is_secure, unless: :uploaded?
  validate :stored_video_object_is_attachable, if: -> { uploaded? && will_save_change_to_s3_key? }

  scope :ordered, -> { order(:position) }
  scope :student_visible, -> { published }

  after_destroy_commit :delete_stored_video

  def self.source_kind_for(url)
    parsed = URI.parse(url.to_s)
    return "external" unless parsed.is_a?(URI::HTTPS)

    host = parsed.host.to_s.downcase.delete_prefix("www.").delete_prefix("m.")
    path = parsed.path.to_s.downcase
    return "youtube" if host == "youtu.be" || host == "youtube.com" || host.end_with?(".youtube.com")
    return "vimeo" if host == "vimeo.com" || host.end_with?(".vimeo.com")
    return "loom" if host == "loom.com" || host.end_with?(".loom.com")
    return "direct" if path.match?(/\.(m3u8|m4v|mov|mp4|webm)\z/)

    "external"
  rescue URI::InvalidURIError
    "external"
  end

  def uploaded?
    source_kind == "uploaded"
  end

  def file_size_display
    return nil unless file_size

    if file_size >= 1.gigabyte
      "#{(file_size / 1.gigabyte.to_f).round(1)} GB"
    elsif file_size >= 1.megabyte
      "#{(file_size / 1.megabyte.to_f).round(1)} MB"
    else
      "#{(file_size / 1.kilobyte.to_f).round(1)} KB"
    end
  end

  def duration_display
    return nil unless duration_seconds
    hours = duration_seconds / 3600
    minutes = (duration_seconds % 3600) / 60
    secs = duration_seconds % 60
    if hours > 0
      format("%d:%02d:%02d", hours, minutes, secs)
    else
      format("%d:%02d", minutes, secs)
    end
  end

  private

  def delete_stored_video
    S3ObjectCleanup.delete_if_unreferenced(s3_key) if uploaded? && s3_key.present?
  end

  def stored_video_object_is_attachable
    S3ObjectCleanup.validate_attachment(self, :s3_key)
  end

  def source_url_is_secure
    parsed = URI.parse(source_url.to_s)
    errors.add(:source_url, "must be a valid HTTPS URL") unless parsed.is_a?(URI::HTTPS) && parsed.host.present?
  rescue URI::InvalidURIError
    errors.add(:source_url, "must be a valid HTTPS URL")
  end
end
