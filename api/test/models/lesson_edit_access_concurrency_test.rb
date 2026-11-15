require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# Two real connections: a revoke must not slip between an instructor's
# access check and the commit of their save (LessonEditAccess, lock: true).
class LessonEditAccessConcurrencyTest < ActiveSupport::TestCase
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Grant race #{slug}")
    @cohort = Cohort.create!(name: "Grant race class #{slug}", curriculum: @curriculum, start_date: Date.current, status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Module", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :text, position: 0, body: "Before")
    @admin = User.create!(clerk_id: "grant_race_admin_#{slug}", email: "grant-race-admin-#{slug}@example.invalid", role: :admin)
    @instructor = User.create!(clerk_id: "grant_race_instructor_#{slug}", email: "grant-race-instructor-#{slug}@example.invalid", role: :instructor)
    @assignment = CohortInstructorAssignment.create!(cohort: @cohort, user: @instructor)
    @assignment.set_lesson_editing!(true, by: @admin)
    @threads = []
  end

  teardown do
    finish_test_threads(@threads)
    ActivityEvent.where(subject_user_id: @instructor&.id).delete_all
    CohortInstructorAssignment.where(id: @assignment&.id).delete_all
    ContentBlock.where(lesson_id: @lesson&.id).delete_all
    Lesson.where(id: @lesson&.id).delete_all
    CurriculumModule.where(id: @module&.id).delete_all
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    delete_test_users(@admin, @instructor)
  end

  { "revoke" => ->(assignment, admin) { CohortInstructorAssignment.find(assignment.id).set_lesson_editing!(false, by: admin) },
    "removal from the cohort" => ->(assignment, _admin) { CohortInstructorAssignment.find(assignment.id).destroy! } }.each do |label, change|
    test "a #{label} waits for a save already past its access check, and later saves are refused" do
      ApplicationRecord.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        LessonEditAccess.authorize!(@instructor, @curriculum, lock: true)
        @lesson.with_authoring_lock { @block.update!(body: "Saved by the instructor") }

        @threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection { change.call(@assignment, @admin) }
        end
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      Timeout.timeout(60) { @threads.first.value }
      assert_equal "Saved by the instructor", @block.reload.body
      error = assert_raises(LessonEditAccess::Denied) do
        ApplicationRecord.transaction { LessonEditAccess.authorize!(@instructor, @curriculum, lock: true) }
      end
      assert_equal "lesson_editing_not_granted", error.code
    end
  end
end
