class Rubric < ApplicationRecord
  belongs_to :curriculum
  has_many :rubric_criteria, -> { ordered }, class_name: "RubricCriterion", foreign_key: :rubric_id,
           inverse_of: :rubric, dependent: :destroy
  has_many :content_blocks, dependent: :restrict_with_error

  validates :title, presence: true, length: { maximum: 160 }
  validates :rubric_criteria, length: { minimum: 1, maximum: 12 }

  scope :active, -> { where(active: true) }
  scope :ordered, -> { order(:title, :id) }

  accepts_nested_attributes_for :rubric_criteria
end
