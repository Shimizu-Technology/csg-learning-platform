require_relative "../support/model_coverage"

class RecoveryPlanCheckInTest < ModelCoverageTestCase
  test "check ins require staff authors nonempty bounded body and plan" do
    row = RecoveryPlanCheckIn.create!(recovery_plan: plan, author: staff, body: "Synthetic check in")
    assert_invalid row, :body, ""
    assert_invalid row, :body, "x" * 4001
    assert_invalid row, :author, student
    assert_invalid row, :recovery_plan, nil
  end
end
