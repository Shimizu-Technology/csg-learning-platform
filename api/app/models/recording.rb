class Recording < ApplicationRecord
  belongs_to :cohort
  belongs_to :uploaded_by, class_name: "User"
  has_many :watch_progresses, dependent: :destroy

  validates :title, presence: true
  validates :s3_key, presence: true, uniqueness: true
  validates :content_type, presence: true
  validates :file_size, presence: true, numericality: { greater_than: 0 }
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :ordered, -> { order(:position) }

  def file_size_display
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
end
