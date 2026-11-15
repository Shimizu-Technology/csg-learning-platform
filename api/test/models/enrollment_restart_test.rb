require_relative "../support/model_coverage"

class EnrollmentRestartTest < ModelCoverageTestCase
  test "restart requires audit snapshot counts and actors while enrollment is optional" do
    row = EnrollmentRestart.create!(enrollment: enrollment, student: student, cohort: course, performed_by: staff,
      snapshot: { "status" => "active" }, records_removed: { "progresses" => 1 })
    assert_invalid row, :snapshot, {}
    assert_invalid row, :records_removed, {}
    assert_invalid row, :performed_by, nil
    plan.update!(enrollment_restart: row)
    row.destroy!
    assert_nil plan.reload.enrollment_restart_id
    optional = EnrollmentRestart.new(student: student, cohort: course, performed_by: staff, snapshot: { "status" => "active" }, records_removed: { "progresses" => 1 })
    assert optional.valid?
  end
end
