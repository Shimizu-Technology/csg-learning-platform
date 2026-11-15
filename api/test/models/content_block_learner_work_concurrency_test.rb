require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# Two real connections: a learner write and a destructive block change must
# never interleave so that the change misses work committed at the same time.
class ContentBlockLearnerWorkConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Concurrent block #{slug}")
    @cohort = Cohort.create!(name: "Concurrent class #{slug}", curriculum: @curriculum, start_date: Date.current, status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Module", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Exercise", body: "Write it.")
    @student = User.create!(clerk_id: "concurrent_block_#{slug}", email: "concurrent-block-#{slug}@example.invalid", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    @progress = Progress.create!(user: @student, enrollment: @enrollment, content_block: @block, status: :not_started)
    @threads = []
  end

  teardown do
    finish_test_threads(@threads)
    Progress.where(enrollment_id: @enrollment&.id).delete_all
    ContentBlock.where(lesson_id: @lesson&.id).delete_all
    Lesson.where(id: @lesson&.id).delete_all
    CurriculumModule.where(id: @module&.id).delete_all
    Enrollment.find_by(id: @enrollment&.id)&.destroy!
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@student)
  end

  {
    "block delete" => ->(block) { ContentBlock.find(block.id).destroy },
    "lesson delete" => ->(block) { Lesson.find(block.lesson_id).destroy },
    "block type change" => ->(block) { ContentBlock.find(block.id).update(block_type: :text) }
  }.each do |label, change|
    test "a completion committed while a #{label} waits is kept" do
      Progress.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        Progress.find(@progress.id).update!(status: :completed)

        @threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection { change.call(@block) }
        end
        # The change can't read learner evidence until the completion commits.
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      result = Timeout.timeout(60) { @threads.first.value }
      assert_equal false, result, "#{label} must be refused once the completion is visible"
      assert ContentBlock.exists?(@block.id)
      assert @block.reload.exercise?
      assert Progress.find(@progress.id).completed?, "the completed progress row survives"
    end
  end

  test "a learner write that starts while a delete holds the lock waits and then finds the block gone" do
    ContentBlock.transaction do
      holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
      ContentBlock.lock_against_learner_writes!([ @block.id ])

      @threads << Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          Progress.find(@progress.id).update!(status: :completed)
          :saved
        rescue ActiveRecord::RecordNotFound
          :block_gone
        end
      end
      wait_for_lock_waiters(holder_pid, workers: @threads)

      # The untouched row carries no work, so the delete is allowed.
      ContentBlock.find(@block.id).destroy!
    end

    assert_equal :block_gone, Timeout.timeout(60) { @threads.first.value }
    assert_not ContentBlock.exists?(@block.id)
    assert_not Progress.exists?(@progress.id)
  end

  test "learner writes on the same block don't wait for each other" do
    other = User.create!(clerk_id: "concurrent_block_other_#{SecureRandom.hex(4)}", email: "concurrent-block-other-#{SecureRandom.hex(4)}@example.invalid", role: :student)
    other_enrollment = Enrollment.create!(user: other, cohort: @cohort, status: :active)
    Progress.transaction do
      Progress.find(@progress.id).update!(status: :in_progress)
      @threads << Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          Progress.create!(user: other, enrollment: other_enrollment, content_block: @block, status: :completed)
          :saved
        end
      end
      assert_equal :saved, Timeout.timeout(10) { @threads.first.value }
    end
  ensure
    Progress.where(enrollment_id: other_enrollment&.id).delete_all
    Enrollment.find_by(id: other_enrollment&.id)&.destroy!
    delete_test_users(other)
  end
end
