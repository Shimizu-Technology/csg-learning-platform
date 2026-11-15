require_relative "../support/model_coverage"

class WorkspaceMembershipTest < ModelCoverageTestCase
  test "membership role transitions and unique user per workspace" do
    row = WorkspaceMembership.create!(workspace: course.workspace, user: student)
    assert row.member?
    row.update!(role: :manager)
    assert row.reload.manager?
    assert_not row.dup.valid?
    other = WorkspaceMembership.create!(workspace: course.workspace, user: person)
    assert_database_rejects other, { user_id: student.id }, ActiveRecord::RecordNotUnique
  end
end
