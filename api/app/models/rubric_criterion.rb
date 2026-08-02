class RubricCriterion < ApplicationRecord
  self.table_name = "rubric_criteria"

  belongs_to :rubric
  belongs_to :learning_objective, optional: true
  has_many :submission_criterion_results, inverse_of: :rubric_criterion, dependent: :restrict_with_error

  validates :title, presence: true, length: { maximum: 160 }
  validates :description, presence: true, length: { maximum: 1_500 }
  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :objective_matches_curriculum

  scope :ordered, -> { order(:position, :id) }

  private

  def objective_matches_curriculum
    return if learning_objective.nil? || learning_objective.curriculum_id == rubric&.curriculum_id

    errors.add(:learning_objective, "must belong to the rubric curriculum")
  end
end
