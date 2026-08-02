class LearningObjective < ApplicationRecord
  belongs_to :curriculum
  has_many :objective_alignments, dependent: :restrict_with_error
  has_many :knowledge_checks, dependent: :restrict_with_error

  before_validation :normalize_code

  validates :code, presence: true, uniqueness: { scope: :curriculum_id }, format: { with: /\A[A-Z0-9][A-Z0-9._-]*\z/ }
  validates :title, presence: true, length: { maximum: 160 }
  validates :success_criteria, presence: true
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :ordered, -> { order(:position, :code) }
  scope :active, -> { where(active: true) }

  private

  def normalize_code
    self.code = code.to_s.strip.upcase
  end
end
