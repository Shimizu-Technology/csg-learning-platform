class MessageAttachment < ApplicationRecord
  belongs_to :message
  belongs_to :uploaded_by, class_name: "User"

  validates :s3_key, presence: true, uniqueness: true
  validates :filename, presence: true
  validates :content_type, presence: true
  validates :byte_size, numericality: { greater_than: 0 }

  def image?
    content_type.start_with?("image/")
  end
end
