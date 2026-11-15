require_relative "../support/model_coverage"

class PushSubscriptionTest < ModelCoverageTestCase
  test "seen restores failed subscriptions and endpoint is unique" do
    row = PushSubscription.create!(user: student, endpoint: "https://example.com/push", p256dh: "key", auth: "auth")
    assert_includes PushSubscription.active, row
    row.mark_failed!
    assert_equal Time.current, row.failed_at
    assert_not PushSubscription.active.exists?(row.id)
    travel 1.minute
    row.mark_seen!
    assert_nil row.reload.failed_at
    assert_equal Time.current, row.last_seen_at
    assert_includes PushSubscription.active, row
    assert_not row.dup.valid?
    assert_invalid row, :p256dh, ""
    assert_invalid row, :auth, ""
    other = PushSubscription.create!(user: student, endpoint: "https://example.com/other", p256dh: "key", auth: "auth")
    assert_database_rejects other, { endpoint: row.endpoint }, ActiveRecord::RecordNotUnique
  end
end
