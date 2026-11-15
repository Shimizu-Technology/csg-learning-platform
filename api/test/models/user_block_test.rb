require_relative "../support/model_coverage"

class UserBlockTest < ModelCoverageTestCase
  test "self blocking is rejected in Ruby and SQL and between is symmetric" do
    row = UserBlock.create!(blocker: student, blocked_user: staff)
    assert_not row.dup.valid?
    assert_database_rejects row, { blocked_user_id: student.id }, constraint: "user_blocks_distinct_users"
    assert_invalid row, :blocked_user, student
    assert_includes UserBlock.between(staff.id, [ student.id ]), row
    assert_equal [ student.id ], UserBlock.related_user_ids(staff.id, [ student.id, person.id ])
    assert_empty UserBlock.related_user_ids(staff.id, [])
    other = UserBlock.create!(blocker: student, blocked_user: person)
    assert_database_rejects other, { blocked_user_id: staff.id }, ActiveRecord::RecordNotUnique, constraint: "index_user_blocks_on_blocker_id_and_blocked_user_id"
  end
end
