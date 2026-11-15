require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"

# User#record_seen! decides in the database, not from the loaded value, so two
# requests holding the same stale user can't both write.
class UserRecordSeenTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    token = SecureRandom.hex(6)
    @user = User.create!(clerk_id: "seen_#{token}", email: "seen-#{token}@example.com", role: :student,
      last_seen_at: 10.minutes.ago)
  end

  teardown do
    delete_test_users(@user)
  end

  test "writes only when the stored value is older than the interval" do
    now = Time.current.change(usec: 0)

    assert @user.record_seen!(now: now)
    assert_equal now, @user.reload.last_seen_at
    refute @user.changed?, "The new value is not left as a pending change"

    refute @user.record_seen!(now: now + 30.seconds)
    assert_equal now, @user.reload.last_seen_at

    later = now + User::LAST_SEEN_WRITE_INTERVAL + 1.second
    assert @user.record_seen!(now: later)
    assert_equal later, @user.reload.last_seen_at
  end

  test "a second request holding the same stale user does not write again" do
    first = User.find(@user.id)
    second = User.find(@user.id)
    now = Time.current.change(usec: 0)

    assert first.record_seen!(now: now)
    refute second.record_seen!(now: now + 1.second), "The stale copy's condition fails in the database"
    assert_equal now, @user.reload.last_seen_at
  end

  test "a request that waits on an in-flight write sees it and skips its own" do
    holder_pid = Queue.new
    release = Queue.new
    first_time = Time.current.change(usec: 0)
    holder = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        User.transaction do
          holder_pid << connection.select_value("SELECT pg_backend_pid()")
          User.find(@user.id).record_seen!(now: first_time).tap { release.pop }
        end
      end
    end
    pid = Timeout.timeout(10) { holder_pid.pop }

    stale = User.find(@user.id)
    waiter = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        stale.record_seen!(now: first_time + 1.second)
      end
    end
    wait_for_lock_waiters(pid, workers: [ waiter ], timeout: 10)
    release << true

    assert holder.value, "The first request writes"
    refute waiter.value, "The waiting request re-checks the committed row and writes nothing"
    assert_equal first_time, @user.reload.last_seen_at
  ensure
    release << true if holder&.alive?
    finish_test_threads(holder, waiter)
  end
end
