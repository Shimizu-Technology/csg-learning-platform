require "test_helper"
require_relative "../support/non_transactional_test_cleanup"

class AdminContinuityTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup

  test "concurrent demotion and archive leave one accepted active admin" do
    token = SecureRandom.hex(8)
    admins = []
    2.times { |i| admins << User.create!(clerk_id: "continuity_#{token}_#{i}", email: "continuity-#{token}-#{i}@example.com", role: :admin) }
    locked = Queue.new
    release = Queue.new
    results = Queue.new
    threads = []
    threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        User.transaction do
          record = User.find(admins.first.id)
          results << [ record.update(role: :instructor), record.errors.full_messages ]
          locked << true
          release.pop
        end
      end
    end
    Timeout.timeout(10) { locked.pop }
    backend = Queue.new
    threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        User.transaction do
          connection.execute("SET LOCAL lock_timeout = '10s'")
          backend << connection.select_value("SELECT pg_backend_pid()")
          record = User.find(admins.last.id)
          results << [ record.update(archived_at: Time.current), record.errors.full_messages ]
        end
      end
    end
    pid = Timeout.timeout(10) { backend.pop }
    blocked = false
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 5
    while Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
      blocked = User.uncached { User.connection.select_value("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = #{Integer(pid)} AND locktype = 'advisory' AND classid = 0 AND objid = 2026102201 AND objsubid = 1 AND NOT granted)") }
      break if blocked
      sleep 0.01
    end
    assert blocked, "second admin removal must wait on the advisory lock while the first transaction is open"
    release << true
    threads.each(&:value)
    outcomes = 2.times.map { results.pop }
    assert_equal true, outcomes.first.first
    assert_equal false, outcomes.last.first
    assert_match "last active admin", outcomes.last.last.join
    assert_equal 1, User.accepted_active_admins.where(id: admins.map(&:id)).count
  ensure
    release << true if release
    finish_test_threads(threads)
    delete_test_users(admins)
  end

  test "stale instructor cannot demote the last admin after promotion" do
    assert_stale_admin_removal_blocked(initial_role: :instructor, pending: false)
  end

  test "invitation acceptance and concurrent demotion complete without a lock inversion" do
    assert_acceptance_with_concurrent_update(role: :instructor)
  end

  test "invitation acceptance and concurrent archive complete without a lock inversion" do
    assert_acceptance_with_concurrent_update(archived_at: Time.current)
  end

  test "stale pending admin cannot be removed after accepting the invitation" do
    assert_stale_admin_removal_blocked(initial_role: :admin, pending: true)
  end

  test "stale instructor cannot destroy the last admin after promotion" do
    assert_stale_admin_removal_blocked(initial_role: :instructor, pending: false, destroying: true)
  end

  test "last accepted admin cannot be archived or destroyed directly" do
    token = SecureRandom.hex(8)
    admin = User.create!(clerk_id: "continuity_#{token}", email: "continuity-#{token}@example.com", role: :admin)
    assert_not admin.update(archived_at: Time.current)
    assert_not admin.destroy
    assert_match "last active admin", admin.errors.full_messages.join
    assert_not admin.reload.archived?
  ensure
    delete_test_users(admin)
  end

  private

  def assert_acceptance_with_concurrent_update(**attributes)
    token = SecureRandom.hex(8)
    admin = User.create!(clerk_id: "continuity_#{token}", email: "continuity-#{token}@example.com", role: :admin)
    pending = User.create!(clerk_id: "pending_#{token}", email: "pending-#{token}@example.com", role: :admin)
    accepting = Queue.new
    updating = Queue.new
    release = Queue.new
    threads = []
    threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        User.find(pending.id).with_lock do
          connection.execute("SET LOCAL lock_timeout = '5s'")
          accepting << connection.select_value("SELECT pg_backend_pid()")
          release.pop
          ApplicationController.new.send(:attach_clerk_identity, User.find(pending.id),
            issuer: "https://continuity.clerk.invalid", clerk_id: "accepted_#{token}")
        end
      end
    rescue StandardError => error
      error
    end
    accepting_pid = Timeout.timeout(10) { accepting.pop }
    threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do |connection|
        User.transaction do
          connection.execute("SET LOCAL lock_timeout = '5s'")
          updating << connection.select_value("SELECT pg_backend_pid()")
          User.find(pending.id).update!(attributes)
        end
      end
    rescue StandardError => error
      error
    end
    updating_pid = Timeout.timeout(10) { updating.pop }
    blocked = false
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 3
    while Process.clock_gettime(Process::CLOCK_MONOTONIC) < deadline
      blocked = User.uncached do
        User.connection.select_value(<<~SQL)
          SELECT EXISTS (
            SELECT 1 FROM pg_locks
            WHERE pid = #{Integer(updating_pid)} AND locktype = 'transactionid' AND NOT granted
          ) AND #{Integer(accepting_pid)} = ANY(pg_blocking_pids(#{Integer(updating_pid)}))
        SQL
      end
      break if blocked
      sleep 0.01
    end
    assert blocked, "the role/archive update must wait on the accepting user's row before acceptance continues"
    release << true
    failures = threads.map(&:value).grep(StandardError)
    assert_empty failures, failures.map { |error| "#{error.class}: #{error.message}" }.join("\n")

    pending.reload
    assert_equal "accepted_#{token}", pending.clerk_id
    assert_equal "accepted", pending.invite_delivery_status
    assert_equal "accepted_#{token}", pending.clerk_identities.sole.clerk_user_id
    attributes.each { |attribute, value| assert_equal value.to_s, pending.public_send(attribute).to_s }
    assert_equal [ admin.id ], User.accepted_active_admins.pluck(:id)
  ensure
    release << true if release
    finish_test_threads(threads)
    delete_test_users(admin, pending)
  end

  def assert_stale_admin_removal_blocked(initial_role:, pending:, destroying: false)
    token = SecureRandom.hex(8)
    admin = User.create!(clerk_id: "continuity_a_#{token}", email: "continuity-a-#{token}@example.com", role: :admin)
    other = User.create!(clerk_id: "#{pending ? 'pending_' : 'continuity_'}b_#{token}", email: "continuity-b-#{token}@example.com", role: initial_role)
    stale = User.find(other.id)
    other.update!(role: :admin, clerk_id: "continuity_accepted_#{token}")
    admin.update!(role: :instructor)

    result = destroying ? stale.destroy : stale.update(role: :student)

    assert_not result
    assert_match "last active admin", stale.errors.full_messages.join
    assert_equal [ other.id ], User.accepted_active_admins.pluck(:id)
  ensure
    delete_test_users(admin, other)
  end
end
