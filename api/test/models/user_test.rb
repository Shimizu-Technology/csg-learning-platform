require_relative "../support/model_coverage"

class UserTest < ModelCoverageTestCase
  test "normalizes handles and rejects reserved invalid and duplicate handles" do
    student.update!(handle: " @MiXeD_Name ")
    assert_equal "mixed_name", student.reload.handle
    assert_invalid student, :handle, "admin"
    assert_invalid student, :handle, "a"
    assert_invalid person, :handle, "mixed_name"
    assert_raises(ActiveRecord::StatementInvalid) do
      User.transaction(requires_new: true) do
        User.connection.execute("UPDATE users SET handle = 'Uppercase' WHERE id = #{student.id.to_i}")
      end
    end
    other = person
    assert_database_rejects other, { handle: student.handle }, ActiveRecord::RecordNotUnique, constraint: "index_users_on_handle"
  end

  test "cohort read and teaching access follow role enrollment expiry and archive state" do
    assert_not student.can_access_cohort?(course)
    enrollment
    assert student.can_access_cohort?(course)
    assert_not student.can_teach_cohort?(course)
    enrollment.update!(status: :paused)
    assert student.can_access_cohort?(course)
    enrollment.update!(access_expires_at: Time.current)
    assert_not student.can_access_cohort?(course)
    instructor = person(:instructor)
    assert_not instructor.can_teach_cohort?(course)
    course.cohort_instructor_assignments.create!(user: instructor)
    assert instructor.can_teach_cohort?(course)
    instructor.update!(archived_at: Time.current)
    assert_not instructor.can_teach_cohort?(course)
    assert staff.can_teach_cohort?(course)
  end

  test "committed role archive restoration and destroy reset cable but profile edits do not" do
    calls = []
    original = CableConnectionReset.method(:call)
    CableConnectionReset.define_singleton_method(:call) { |user| calls << user.id }
    student.update!(first_name: "Renamed")
    assert_empty calls
    student.update!(role: :instructor)
    student.update!(archived_at: Time.current)
    student.update!(archived_at: nil)
    student.destroy!
    assert_equal [ student.id ] * 4, calls
  ensure
    CableConnectionReset.define_singleton_method(:call, original)
  end

  test "archive deletes device credentials and archives a two person conversation" do
    enrollment
    conversation
    push = PushSubscription.create!(user: student, endpoint: "https://example.com/push", p256dh: "key", auth: "auth")
    student.archive!
    assert student.reload.archived?
    assert_not PushSubscription.exists?(push.id)
    assert conversation.reload.archived?
    assert_not User.not_archived.exists?(student.id)
    student.unarchive!
    assert_not student.reload.archived?
  end
  test "hard deleting a message author preserves the nullified historical message" do
    skip "Known integrity mismatch: User.messages nullifies author_id but messages.author_id is NOT NULL; requires an identity-retention policy decision"
    sample_message
    student.destroy!
    assert_nil sample_message.reload.author_id
  end
end
