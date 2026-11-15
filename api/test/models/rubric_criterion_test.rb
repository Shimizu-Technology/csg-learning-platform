require_relative "../support/model_coverage"

class RubricCriterionTest < ModelCoverageTestCase
  test "recorded feedback prevents edits and deletion and database rejects negative positions" do
    criterion = rubric.rubric_criteria.first!
    assert_invalid criterion, :title, ""
    assert_invalid criterion, :description, ""
    assert_database_rejects criterion, { position: -1 }
    block.update!(rubric: rubric)
    SubmissionCriterionResult.create!(submission: submission, rubric_criterion: criterion, rating: :meets)
    assert_not criterion.update(title: "Changed")
    assert_not criterion.destroy
    assert RubricCriterion.exists?(criterion.id)
  end
end
