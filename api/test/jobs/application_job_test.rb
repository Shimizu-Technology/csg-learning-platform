require "test_helper"
require_relative "../support/after_commit_helpers"

class ApplicationJobTest < ActiveSupport::TestCase
  include AfterCommitHelpers

  class ProbeJob < ApplicationJob
    cattr_accessor :events, default: []

    def perform(label, fail: false)
      events << [ :performed, label, ActiveRecord.all_open_transactions.size ]
      raise "probe failed" if fail
    end
  end

  setup { ProbeJob.events = [] }

  test "every application job enqueues after the surrounding transaction commits" do
    assert ApplicationJob.enqueue_after_transaction_commit
    assert PushNotificationJob.enqueue_after_transaction_commit
    assert SubmissionNotificationJob.enqueue_after_transaction_commit
  end

  test "an inline job requested inside a transaction runs after it commits" do
    with_inline_jobs do
      User.transaction do
        assert ProbeJob.perform_later("inside"), "a deferred enqueue still reports success"
        ProbeJob.events << [ :still_in_transaction ]
      end
    end

    assert_equal [ [ :still_in_transaction ], [ :performed, "inside", 0 ] ], ProbeJob.events
  end

  test "an inline job requested inside a row lock runs after the lock is released" do
    user = User.create!(clerk_id: "after_commit_lock", email: "after-commit-lock@example.com")

    with_inline_jobs do
      user.with_lock do
        ProbeJob.perform_later("locked")
        ProbeJob.events << [ :lock_held ]
      end
    end

    assert_equal [ [ :lock_held ], [ :performed, "locked", 0 ] ], ProbeJob.events
  end

  test "a job requested inside a rolled-back transaction never runs" do
    with_inline_jobs do
      User.transaction do
        ProbeJob.perform_later("rolled back")
        raise ActiveRecord::Rollback
      end
    end

    assert_empty ProbeJob.events
  end

  test "a job requested in a savepoint waits for the outer transaction" do
    with_inline_jobs do
      User.transaction do
        User.transaction(requires_new: true) { ProbeJob.perform_later("savepoint") }
        ProbeJob.events << [ :savepoint_released ]
      end
    end

    assert_equal [ [ :savepoint_released ], [ :performed, "savepoint", 0 ] ], ProbeJob.events
  end

  test "a job requested in a rolled-back savepoint never runs even when the outer transaction commits" do
    with_inline_jobs do
      User.transaction do
        User.transaction(requires_new: true) do
          ProbeJob.perform_later("savepoint")
          raise ActiveRecord::Rollback
        end
      end
    end

    assert_empty ProbeJob.events
  end

  test "a job requested in the message delivery lock transaction waits for that commit" do
    with_inline_jobs do
      MessageDeliveryLockRecord.connection_pool.with_connection do |connection|
        connection.transaction(requires_new: true) do
          ProbeJob.perform_later("delivery lock")
          ProbeJob.events << [ :delivery_lock_held ]
        end
      end
    end

    assert_equal [ [ :delivery_lock_held ], [ :performed, "delivery lock", 0 ] ], ProbeJob.events
  end

  test "without a transaction an inline job runs at once and its failure reaches the caller" do
    with_inline_jobs do
      error = assert_raises(RuntimeError) { ProbeJob.perform_later("immediate", fail: true) }
      assert_equal "probe failed", error.message
    end

    assert_equal [ [ :performed, "immediate", 0 ] ], ProbeJob.events
  end

  test "a failing deferred job keeps the committed write and the remaining commit callbacks" do
    user = User.create!(clerk_id: "after_commit_failure", email: "after-commit-failure@example.com", first_name: "Before")
    reported = []
    subscriber = Object.new
    subscriber.define_singleton_method(:report) { |error, **_context| reported << error.message }
    Rails.error.subscribe(subscriber)

    with_inline_jobs do
      User.transaction do
        user.update!(first_name: "Committed")
        ProbeJob.perform_later("first", fail: true)
        ProbeJob.perform_later("second")
      end
    end

    assert_equal "Committed", user.reload.first_name
    assert_equal [ [ :performed, "first", 0 ], [ :performed, "second", 0 ] ], ProbeJob.events
    assert_includes reported, "probe failed"
  ensure
    Rails.error.unsubscribe(subscriber) if subscriber
  end
end
