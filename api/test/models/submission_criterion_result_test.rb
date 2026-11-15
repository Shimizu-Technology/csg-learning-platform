require_relative "../support/model_coverage"

class SubmissionCriterionResultTest < ModelCoverageTestCase
  test "rating requires matching rubric and result is unique per criterion" do
    block.update!(rubric: rubric)
    criterion = rubric.rubric_criteria.first!
    row = SubmissionCriterionResult.create!(submission: submission, rubric_criterion: criterion, rating: :meets)
    assert row.meets?
    assert_invalid row, :rating, "invalid"
    assert_not row.dup.valid?
    other_submission = Submission.create!(user: student, content_block: block)
    other = SubmissionCriterionResult.create!(submission: other_submission, rubric_criterion: criterion, rating: :redo)
    assert_database_rejects other, { submission_id: submission.id }, ActiveRecord::RecordNotUnique, constraint: "idx_submission_criterion_results_unique"
    row.submission = Submission.create!(user: student, content_block: lesson.content_blocks.create!(block_type: :exercise, position: 2))
    assert_not row.valid?
    assert row.errors[:rubric_criterion].any?
    row.reload
    submission.destroy!
    assert_not SubmissionCriterionResult.exists?(row.id)
  end
end
