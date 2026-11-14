require "test_helper"

class AgentPostingTokenTest < ActiveSupport::TestCase
  def setup
    @admin = User.create!(clerk_id: "ap_model_admin", email: "ap-model-admin@example.com", first_name: "Owner", role: :admin)
  end

  test "issue stores only a SHA-256 digest and returns the prefixed plaintext once" do
    record, plaintext = AgentPostingToken.issue!(user: @admin, name: "  Home   base  ")

    assert_match AgentPostingToken::FORMAT, plaintext
    assert_equal Digest::SHA256.hexdigest(plaintext), record.token_digest
    assert_not_includes record.reload.attributes.values, plaintext
    assert_equal "Home base", record.name
    assert_equal AgentPostingToken::SCOPE, record.scope
    assert_equal "active", record.status
    assert_equal record, AgentPostingToken.authenticate(plaintext)
  end

  test "authenticate rejects unknown wrong-prefix revoked and expired tokens" do
    record, plaintext = AgentPostingToken.issue!(user: @admin, name: "Assistant", expires_at: 1.day.from_now)

    assert_nil AgentPostingToken.authenticate(nil)
    assert_nil AgentPostingToken.authenticate("")
    assert_nil AgentPostingToken.authenticate(plaintext.sub(AgentPostingToken::PREFIX, HomeBaseToken::PREFIX))
    assert_nil AgentPostingToken.authenticate(plaintext + "0")

    travel 2.days do
      assert_nil AgentPostingToken.authenticate(plaintext)
      assert_equal "expired", record.reload.status
    end

    record.revoke!
    assert_nil AgentPostingToken.authenticate(plaintext)
    assert_equal "revoked", record.reload.status
  end

  test "a home base token can never authenticate as a posting token" do
    _record, home_base = HomeBaseToken.issue!(user: @admin)

    assert_nil AgentPostingToken.authenticate(home_base)
  end

  test "owner must be an accepted active admin when issuing and when using" do
    student = User.create!(clerk_id: "ap_model_student", email: "ap-model-student@example.com", role: :student)
    instructor = User.create!(clerk_id: "ap_model_instructor", email: "ap-model-instructor@example.com", role: :instructor)
    pending = User.create!(clerk_id: "pending_ap_model", email: "ap-model-pending@example.com", role: :admin)
    [ student, instructor, pending ].each do |user|
      assert_raises(ActiveRecord::RecordInvalid) { AgentPostingToken.issue!(user: user, name: "Nope") }
    end

    _record, plaintext = AgentPostingToken.issue!(user: @admin, name: "Assistant")
    @admin.update_columns(role: User.roles[:instructor])
    assert_nil AgentPostingToken.authenticate(plaintext)
    @admin.update_columns(role: User.roles[:admin], archived_at: Time.current)
    assert_nil AgentPostingToken.authenticate(plaintext)
    @admin.update_columns(archived_at: nil, clerk_id: "pending_owner")
    assert_nil AgentPostingToken.authenticate(plaintext)
    @admin.update_columns(clerk_id: "ap_model_admin")
    assert AgentPostingToken.authenticate(plaintext)
  end

  test "name expiry scope and active-token limit are validated" do
    assert_raises(ActiveRecord::RecordInvalid) { AgentPostingToken.issue!(user: @admin, name: " ") }
    assert_raises(ActiveRecord::RecordInvalid) { AgentPostingToken.issue!(user: @admin, name: "x" * 61) }
    assert_raises(ActiveRecord::RecordInvalid) { AgentPostingToken.issue!(user: @admin, name: "Past", expires_at: 1.minute.ago) }
    record, = AgentPostingToken.issue!(user: @admin, name: "Scoped")
    record.scope = "messages:read"
    assert_not record.valid?

    (AgentPostingToken::ACTIVE_LIMIT - 1).times { |index| AgentPostingToken.issue!(user: @admin, name: "Token #{index}") }
    assert_raises(ActiveRecord::RecordInvalid) { AgentPostingToken.issue!(user: @admin, name: "One too many") }
    record.revoke!
    assert AgentPostingToken.issue!(user: @admin, name: "Replacement")
  end

  test "unknown and revoked tokens still use fixed length constant time digest comparison" do
    record, plaintext = AgentPostingToken.issue!(user: @admin, name: "Timing")
    original = ActiveSupport::SecurityUtils.method(:secure_compare)
    calls = []
    ActiveSupport::SecurityUtils.define_singleton_method(:secure_compare) { |left, right| calls << [ left.length, right.length ]; original.call(left, right) }
    assert_nil AgentPostingToken.authenticate("wrong")
    record.revoke!
    assert_nil AgentPostingToken.authenticate(plaintext)
    assert_equal [ [ 64, 64 ], [ 64, 64 ] ], calls
  ensure
    ActiveSupport::SecurityUtils.define_singleton_method(:secure_compare, original) if original
  end
end
