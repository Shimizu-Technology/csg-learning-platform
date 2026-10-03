class CurriculumResource < ApplicationRecord
  MAX_FILE_SIZE = 50.megabytes
  DOWNLOAD_EXPIRY = 5.minutes.to_i

  belongs_to :curriculum
  scope :ready, -> { where(ready: true) }

  validates :title, presence: true, length: { maximum: 160 }
  validates :filename, format: { with: /\A[a-zA-Z0-9._-]+\.zip\z/i }, length: { maximum: 180 }
  validates :file_size, numericality: { only_integer: true, greater_than: 0, less_than_or_equal_to: MAX_FILE_SIZE }
  validates :s3_key, :upload_key, :upload_expires_at, presence: true

  def resource_json
    { id: "file-#{id}", download_id: id, title: title, filename: filename,
      file_size: file_size, url: "", category: "download", description: "Course learner ZIP", curriculum_id: curriculum_id }
  end
end
