# One saved state of a Learn Doc. Revisions are numbered 1..n per doc under
# the doc's row lock and never change once written; `created_at` is when the
# doc had this state, so pause projections can pick the newest one a paused
# learner could read.
class CohortDocRevision < ApplicationRecord
  belongs_to :cohort_file
  belongs_to :edited_by, class_name: "User", optional: true

  before_validation :normalize_text

  validates :revision_number, numericality: { only_integer: true, greater_than: 0 }
  validates :title, presence: true, length: { maximum: 160 }
  validates :content, length: { maximum: CohortFile::MAX_DOC_LENGTH }
  validates :summary, length: { maximum: 200 }
  validate :no_null_bytes

  def revision_json(include_content: false)
    json = {
      id: id, cohort_file_id: cohort_file_id, revision_number: revision_number, title: title, summary: summary,
      edited_by_name: edited_by&.full_name, created_at: created_at.iso8601(6), content_length: content.length
    }
    include_content ? json.merge(content: content) : json
  end

  private

  def no_null_bytes
    %i[title summary].each { |field| errors.add(field, "can't contain null characters") if self[field]&.include?("\u0000") }
  end

  def normalize_text
    self.content = content.to_s
    self.summary = summary.to_s.squish.presence
  end
end
