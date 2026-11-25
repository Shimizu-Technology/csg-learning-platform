# A review comment on a file in a student's folder. Only that student and
# cohort staff can read or write them.
class CohortFileComment < ApplicationRecord
  MAX_BODY_LENGTH = 4_000

  belongs_to :cohort_file
  belongs_to :user

  before_validation :normalize_body

  validates :body, presence: true, length: { maximum: MAX_BODY_LENGTH }
  validate :no_null_bytes

  def comment_json(viewer:, can_write:)
    {
      id: id, cohort_file_id: cohort_file_id, body: body, created_at: created_at.iso8601,
      author_id: user_id, author_name: user.full_name, author_role: user.student? ? "student" : "staff",
      can_delete: can_write && (viewer.staff? || user_id == viewer.id)
    }
  end

  private

  def normalize_body
    self.body = body.to_s.strip.presence
  end

  def no_null_bytes
    errors.add(:body, "can't contain null characters") if body&.include?("\u0000")
  end
end
