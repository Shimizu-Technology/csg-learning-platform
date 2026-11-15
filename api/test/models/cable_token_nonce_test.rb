require_relative "../support/model_coverage"

class CableTokenNonceTest < ModelCoverageTestCase
  test "active and expired scopes partition used and expired nonces at exact deadline" do
    row = CableTokenNonce.create!(user: student, nonce: "synthetic", expires_at: 1.second.from_now)
    assert_includes CableTokenNonce.active, row
    assert_not CableTokenNonce.expired_or_used.exists?(row.id)
    row.update!(used_at: Time.current)
    assert_not CableTokenNonce.active.exists?(row.id)
    assert_includes CableTokenNonce.expired_or_used, row
    row.update!(used_at: nil, expires_at: Time.current)
    assert_includes CableTokenNonce.expired_or_used, row
    assert_invalid row, :expires_at, nil
    assert_not row.dup.valid?
    other = CableTokenNonce.create!(user: student, nonce: "other", expires_at: 1.hour.from_now)
    assert_database_rejects other, { nonce: row.nonce }, ActiveRecord::RecordNotUnique, constraint: "index_cable_token_nonces_on_nonce"
  end
end
