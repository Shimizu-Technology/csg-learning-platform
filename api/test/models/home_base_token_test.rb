require_relative "../support/model_coverage"

class HomeBaseTokenTest < ModelCoverageTestCase
  test "issue stores only a digest and authentication checks revocation role archive and pending invitation" do
    token, plaintext = HomeBaseToken.issue!(user: staff)
    assert plaintext.start_with?(HomeBaseToken::PREFIX)
    assert_not_equal plaintext, token.token_digest
    assert_equal token, HomeBaseToken.authenticate(plaintext)
    assert_nil HomeBaseToken.authenticate("invalid")
    staff.update_column(:role, :student)
    assert_nil HomeBaseToken.authenticate(plaintext)
    staff.update_column(:role, :admin)
    staff.update_column(:archived_at, Time.current)
    assert_nil HomeBaseToken.authenticate(plaintext)
    staff.update_columns(archived_at: nil, clerk_id: "pending_synthetic")
    assert_nil HomeBaseToken.authenticate(plaintext)
    staff.update_column(:clerk_id, "accepted_synthetic")
    token.revoke!
    assert_equal Time.current, token.reload.revoked_at
    assert_nil HomeBaseToken.authenticate(plaintext)
    assert_invalid HomeBaseToken.new(token_digest: "a" * 64), :user, student
    other, = HomeBaseToken.issue!(user: staff)
    assert_database_rejects other, { token_digest: token.token_digest }, ActiveRecord::RecordNotUnique
  end
end
