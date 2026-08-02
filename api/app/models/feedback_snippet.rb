class FeedbackSnippet < ApplicationRecord
  belongs_to :created_by, class_name: "User", inverse_of: :feedback_snippets

  validates :title, presence: true, length: { maximum: 100 }
  validates :body, presence: true, length: { maximum: 2_000 }
  validates :usage_count, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  before_validation :derive_title, if: -> { title.blank? && body.present? }

  scope :active, -> { where(active: true) }
  scope :recommended, -> { order(usage_count: :desc, updated_at: :desc, id: :desc) }

  private

  def derive_title
    self.title = body.to_s.squish.truncate(80, separator: " ")
  end
end
