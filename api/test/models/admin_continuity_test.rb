require "test_helper"

class AdminContinuityTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "concurrent demotion and archive leave one accepted active admin" do
    token = SecureRandom.hex(8)
    admins = 2.times.map { |i| User.create!(clerk_id: "continuity_#{token}_#{i}", email: "continuity-#{token}-#{i}@example.com", role: :admin) }
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
      blocked = User.connection.select_value("SELECT EXISTS (SELECT 1 FROM pg_locks WHERE pid = #{Integer(pid)} AND locktype = 'advisory' AND NOT granted)")
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
    threads&.each { |thread| thread.join(15) }
    User.where(id: admins&.map(&:id)).delete_all
  end

  test "stale instructor cannot demote the last admin after promotion" do
    assert_stale_admin_removal_blocked(initial_role: :instructor, pending: false)
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
    User.where(id: admin&.id).delete_all
  end

  private

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
    User.where(id: [ admin&.id, other&.id ]).delete_all
  end
end
