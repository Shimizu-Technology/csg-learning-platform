require "test_helper"
require_relative "../support/lock_wait_helpers"
require_relative "../support/non_transactional_test_cleanup"

class CurriculumAvailabilityConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include LockWaitHelpers
  include NonTransactionalTestCleanup

  %w[create checkout].each do |operation|
    test "#{operation} waits for curriculum lock and rejects a concurrently archived curriculum" do
      curriculum = Curriculum.create!(name: "Availability race #{operation}")
      cohort = if operation == "checkout"
        Cohort.create!(name: "Closed offering", curriculum: curriculum, start_date: Date.current, status: :completed, course_delivery: "self_paced")
      end
      worker = nil
      started = Queue.new
      curriculum.with_lock do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        worker = Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            record = cohort ? Cohort.find(cohort.id) : Cohort.new(name: "Concurrent create", curriculum_id: curriculum.id, start_date: Date.current)
            record.public_checkout_enabled = true if cohort
            started << true
            [ record.save, record.errors.full_messages ]
          end
        end
        started.pop
        wait_for_lock_waiters(holder_pid, workers: [ worker ])
        curriculum.update!(status: :archived)
      end
      worker.join(10)
      refute worker.alive?, "Save should finish after curriculum lock release"
      saved, errors = worker.value
      refute saved
      assert_includes errors.join, "is archived"
      refute Cohort.where(curriculum_id: curriculum.id, public_checkout_enabled: true).exists?
      assert_equal(cohort ? 1 : 0, Cohort.where(curriculum_id: curriculum.id).count)
    ensure
      finish_test_threads(worker)
      cohort&.reload&.destroy!
      curriculum&.destroy!
    end
  end
end
