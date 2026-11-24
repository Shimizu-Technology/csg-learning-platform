# One reply on a help request (U-4.7). A staff "Reply" keeps the request open;
# "Reply & resolve" also resolves it (`resolved_request`). The learner sees
# every reply; the request's `staff_response` mirrors the latest staff one.
# The learner who asked can follow up in the same thread once staff replied,
# so a question back from the instructor never strands them.
class HelpRequestReply < ApplicationRecord
  CLIENT_REQUEST_ID = /\A[A-Za-z0-9_-]{8,64}\z/

  # True when this reply was found by a retried request's client id instead of
  # being saved by it, so the caller sends nothing again.
  attr_accessor :replayed

  belongs_to :help_request
  belongs_to :author, class_name: "User"

  normalizes :body, with: ->(body) { MarkdownText.normalize(body) }

  validates :body, presence: true, length: { maximum: 2_000 }
  validate :author_can_reply
  validates :client_request_id, format: { with: CLIENT_REQUEST_ID }, allow_nil: true

  scope :thread_order, -> { order(:created_at, :id) }

  def from_student?
    author_id.present? && author_id == help_request&.student_id
  end

  private

  def author_can_reply
    return unless author
    return if author.staff?
    return if from_student? && !resolved_request

    errors.add(:author, "must be staff or the learner who asked")
  end
end
