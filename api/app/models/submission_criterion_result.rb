class SubmissionCriterionResult < ApplicationRecord
  enum :rating, { exceeds: 0, meets: 1, developing: 2, redo: 3 }, validate: true

  belongs_to :submission
  belongs_to :rubric_criterion, class_name: "RubricCriterion", foreign_key: :rubric_criterion_id,
             inverse_of: :submission_criterion_results

  validates :rubric_criterion_id, uniqueness: { scope: :submission_id }
  validate :criterion_matches_submission_rubric

  private

  def criterion_matches_submission_rubric
    return if submission&.content_block&.rubric_id == rubric_criterion&.rubric_id

    errors.add(:rubric_criterion, "must belong to the submission rubric")
  end
end
