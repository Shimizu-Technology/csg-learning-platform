require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# Two real connections: a move between modules reads learner work only after
# locking the lesson's blocks, so work committed while it waits still counts.
class LessonMoveConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Move race #{slug}")
    @cohort = Cohort.create!(name: "Move race class #{slug}", curriculum: @curriculum, start_date: Date.current, status: :active)
    @source = CurriculumModule.create!(curriculum: @curriculum, name: "Source", position: 0, day_offset: 0, schedule_days: "weekdays")
    @target = CurriculumModule.create!(curriculum: @curriculum, name: "Target", position: 1, day_offset: 7, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @source, title: "Lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :exercise, position: 0, title: "Exercise", body: "Write it.")
    @student = User.create!(clerk_id: "move_race_#{slug}", email: "move-race-#{slug}@example.invalid", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @source, unlocked: true)
    @threads = []
  end

  teardown do
    finish_test_threads(@threads)
    Progress.where(enrollment_id: @enrollment&.id).delete_all
    ModuleAssignment.where(enrollment_id: @enrollment&.id).delete_all
    ContentBlock.where(lesson_id: @lesson&.id).delete_all
    Lesson.where(id: @lesson&.id).delete_all
    CurriculumModule.where(id: [ @source&.id, @target&.id ]).delete_all
    Enrollment.find_by(id: @enrollment&.id)&.destroy!
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@student)
  end

  test "a completion committed while a move waits blocks the move" do
    Progress.transaction do
      holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
      Progress.create!(user: @student, enrollment: @enrollment, content_block: @block, status: :completed)

      @threads << Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          LessonMove.new(lesson: Lesson.find(@lesson.id), module_id: @target.id, release_day: 0, position: 0,
                         base_updated_at: @lesson.updated_at.iso8601(6)).move!
          :moved
        rescue LessonMove::Invalid => error
          error.code
        end
      end
      wait_for_lock_waiters(holder_pid, workers: @threads)
    end

    assert_equal "learner_access", Timeout.timeout(60) { @threads.first.value }
    assert_equal @source.id, @lesson.reload.module_id
    assert Progress.exists?(content_block_id: @block.id, enrollment_id: @enrollment.id)
  end
end
