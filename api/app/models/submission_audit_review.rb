class SubmissionAuditReview < ApplicationRecord
  belongs_to :content_block
  belongs_to :reviewed_by, class_name: "User", optional: true
  validates :content_digest, presence: true
end
