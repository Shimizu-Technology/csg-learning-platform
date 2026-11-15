require_relative "../support/model_coverage"

class RecoveryPlanTest < ModelCoverageTestCase
  test "completion requires outcome stamps time and reactivation clears completion" do
    assert plan.status_active?
    assert_includes RecoveryPlan.due, plan
    assert_not plan.update(status: :completed)
    plan.reload.update!(status: :completed, outcome: "Required work finished")
    assert_equal Time.current, plan.completed_at
    assert_not RecoveryPlan.due.exists?(plan.id)
    plan.update!(status: :active)
    assert_nil plan.completed_at
    assert_invalid plan, :owner, student
    assert_invalid plan, :target_pace, ""
  end

  test "one active plan per enrollment and destroy removes check ins" do
    other = plan.dup
    other.status = :canceled
    other.save!
    assert_database_rejects other, { status: :active }, ActiveRecord::RecordNotUnique, constraint: "index_recovery_plans_one_active"
    check_in = plan.check_ins.create!(author: staff, body: "Checked in")
    plan.destroy!
    assert_not RecoveryPlanCheckIn.exists?(check_in.id)
  end
end
