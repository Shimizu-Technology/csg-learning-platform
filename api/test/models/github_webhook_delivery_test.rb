require "test_helper"

class GithubWebhookDeliveryTest < ActiveSupport::TestCase
  test "validates required fields, uniqueness, state inclusion, non-negative attempts, and hash payload" do
    now = Time.current
    delivery = GithubWebhookDelivery.create!(
      delivery_id: "del-model-1",
      event: "check_run",
      action: "completed",
      installation_id: 123,
      repository_id: 98765,
      head_sha: "abc1234",
      payload: { "check_run" => { "external_id" => 1 } },
      processing_state: "pending",
      attempts: 0,
      received_at: now
    )
    assert delivery.persisted?
    assert_not delivery.settled?

    duplicate = GithubWebhookDelivery.new(delivery_id: "del-model-1", event: "check_run", received_at: now)
    assert_not duplicate.valid?
    assert_includes duplicate.errors[:delivery_id], "has already been taken"

    invalid_state = GithubWebhookDelivery.new(delivery_id: "del-model-2", event: "check_run", processing_state: "bogus", received_at: now)
    assert_not invalid_state.valid?
    assert_includes invalid_state.errors[:processing_state], "is not included in the list"

    negative_attempts = GithubWebhookDelivery.new(delivery_id: "del-model-3", event: "check_run", attempts: -1, received_at: now)
    assert_not negative_attempts.valid?
    assert_includes negative_attempts.errors[:attempts], "must be greater than or equal to 0"

    bad_payload = GithubWebhookDelivery.new(delivery_id: "del-model-4", event: "check_run", payload: [ "not", "object" ], received_at: now)
    assert_not bad_payload.valid?
    assert_includes bad_payload.errors[:payload], "must be a JSON object"
  end

  test "prune_expired! removes only expired processed and ignored deliveries" do
    now = Time.zone.parse("2026-11-22 12:00:00 UTC")
    old_processed = GithubWebhookDelivery.create!(delivery_id: "old-proc", event: "check_run", processing_state: "processed", received_at: now - 40.days, processed_at: now - 35.days)
    old_ignored = GithubWebhookDelivery.create!(delivery_id: "old-ign", event: "push", processing_state: "ignored", received_at: now - 40.days, processed_at: now - 31.days)
    recent_processed = GithubWebhookDelivery.create!(delivery_id: "rec-proc", event: "check_run", processing_state: "processed", received_at: now - 5.days, processed_at: now - 5.days)
    old_staged = GithubWebhookDelivery.create!(delivery_id: "old-staged", event: "check_run", processing_state: "staged", received_at: now - 40.days)
    old_pending = GithubWebhookDelivery.create!(delivery_id: "old-pending", event: "check_run", processing_state: "pending", received_at: now - 40.days)
    old_failed = GithubWebhookDelivery.create!(delivery_id: "old-failed", event: "check_run", processing_state: "failed", received_at: now - 40.days, last_error: "boom")

    deleted = GithubWebhookDelivery.prune_expired!(older_than: now - 30.days)
    assert_equal 2, deleted
    assert_not GithubWebhookDelivery.exists?(old_processed.id)
    assert_not GithubWebhookDelivery.exists?(old_ignored.id)
    assert GithubWebhookDelivery.exists?(recent_processed.id)
    assert GithubWebhookDelivery.exists?(old_staged.id)
    assert GithubWebhookDelivery.exists?(old_pending.id)
    assert GithubWebhookDelivery.exists?(old_failed.id)
  end
end
