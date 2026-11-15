require_relative "../support/model_coverage"

class AuthSessionTest < ModelCoverageTestCase
  test "digest length and uniqueness are enforced per user including SQL" do
    row = AuthSession.create!(user: student, session_digest: "a" * 64)
    assert_invalid row, :session_digest, "short"
    assert_not row.dup.valid?
    other = AuthSession.create!(user: student, session_digest: "b" * 64)
    assert_database_rejects other, { session_digest: row.session_digest }, ActiveRecord::RecordNotUnique, constraint: "index_auth_sessions_on_user_id_and_session_digest"
    assert AuthSession.create!(user: person, session_digest: row.session_digest).persisted?
    student.destroy!
    assert_not AuthSession.exists?(row.id)
  end
end
