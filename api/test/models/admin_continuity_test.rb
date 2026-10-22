require "test_helper"

class AdminContinuityTest < ActiveSupport::TestCase
  self.use_transactional_tests = false

  test "concurrent demotion and archive leave one accepted active admin" do
    token = SecureRandom.hex(8)
    admins = 2.times.map { |i| User.create!(clerk_id: "continuity_#{token}_#{i}", email: "continuity-#{token}-#{i}@example.com", role: :admin) }
    ready = Queue.new
    start = Queue.new
    results = Queue.new
    threads = admins.each_with_index.map do |admin, index|
      Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          record = User.find(admin.id)
          ready << true
          start.pop
          result = index.zero? ? record.update(role: :instructor) : record.update(archived_at: Time.current)
          results << [ result, record.errors.full_messages ]
        end
      end
    end
    2.times { ready.pop }
    2.times { start << true }
    threads.each(&:value)
    outcomes = 2.times.map { results.pop }
    assert_equal 1, outcomes.count { |result, _| result }
    assert_match "last active admin", outcomes.find { |result, _| !result }.last.join
    assert_equal 1, User.accepted_active_admins.where(id: admins.map(&:id)).count
  ensure
    threads&.each { |thread| thread.join(5) }
    User.where(id: admins&.map(&:id)).delete_all
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
end
