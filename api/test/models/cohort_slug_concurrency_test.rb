require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

class CohortSlugConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  module HoldAllocation
    mattr_accessor :callback

    def assign_public_slug
      super
      HoldAllocation.callback&.call(self)
    end
  end

  Cohort.prepend(HoldAllocation) unless Cohort.ancestors.include?(HoldAllocation)

  setup do
    @curriculum = Curriculum.create!(name: "Synthetic slug race", status: :active)
    @other_curriculum = Curriculum.create!(name: "Other synthetic slug race", status: :active)
    @threads = []
    @release = Queue.new
    Cohort.create!(name: "First", public_title: "Python", curriculum: @curriculum, start_date: Date.current)
  end

  teardown do
    @release << :go
    finish_test_threads(@threads)
    HoldAllocation.callback = nil
    Cohort.where(curriculum: [ @curriculum, @other_curriculum ]).find_each(&:destroy!)
    @curriculum&.destroy!
    @other_curriculum&.destroy!
  end

  test "colliding suffixes from different public titles allocate serially" do
    holding = Queue.new
    HoldAllocation.callback = lambda do |cohort|
      next unless cohort.curriculum_id == @curriculum.id && cohort.public_title == "Python"

      HoldAllocation.callback = nil
      holding << ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
      Timeout.timeout(30) { @release.pop }
    end
    first = allocate_in_thread("Python", failure_queue: holding)
    holder_pid = Timeout.timeout(30) { holding.pop }
    assert_kind_of Integer, holder_pid, holder_pid.inspect
    second = allocate_in_thread("Python 2", curriculum: @other_curriculum)
    wait_for_lock_waiters(holder_pid, workers: [ second ])
    @release << :go
    assert_equal "python-2", Timeout.timeout(30) { first.value }
    assert_equal "python-2-2", Timeout.timeout(30) { second.value }
    assert_equal 3, Cohort.where(curriculum: [ @curriculum, @other_curriculum ]).distinct.count(:public_slug)
  end

  private

  def allocate_in_thread(title, curriculum: @curriculum, failure_queue: nil)
    @threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        Cohort.create!(name: "Synthetic #{title}", public_title: title, curriculum: curriculum, start_date: Date.current).public_slug
      end
    rescue StandardError => error
      failure_queue&.push(error)
      error
    end
    @threads.last
  end
end
