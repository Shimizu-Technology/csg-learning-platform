require_relative "../support/model_coverage"

class LearningPlanRevisionTest < ModelCoverageTestCase
  test "revision persists audit snapshot requires author and is destroyed with plan" do
    learning = LearningPlan.create!(enrollment: enrollment, title: "Plan")
    row = LearningPlanRevision.create!(learning_plan: learning, author: staff, snapshot: learning.snapshot)
    assert_equal "Plan", row.reload.snapshot["title"]
    assert_invalid row, :author, nil
    assert_invalid row, :learning_plan, nil
    learning.destroy!
    assert_not LearningPlanRevision.exists?(row.id)
  end
end
