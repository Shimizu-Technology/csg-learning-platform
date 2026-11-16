# One staff reply to a help request (U-4.7). "Reply" keeps the request open;
# "Reply & resolve" also resolves it (`resolved_request`). The learner sees
# every reply; the request's `staff_response` mirrors the latest one.
class HelpRequestReply < ApplicationRecord
  belongs_to :help_request
  belongs_to :author, class_name: "User"

  normalizes :body, with: ->(body) { MarkdownText.normalize(body) }

  validates :body, presence: true, length: { maximum: 2_000 }
  validates :author, staff_role: true

  scope :thread_order, -> { order(:created_at, :id) }
end
