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
    @other_curriculum = Curriculum.create!(name: "Grant race other #{slug}")
    @other_cohort = Cohort.create!(name: "Grant race other class #{slug}", curriculum: @other_curriculum, start_date: Date.current, status: :active)
    @joined = []
    @threads = []
  end

  teardown do
    finish_test_threads(@threads)
    ActivityEvent.where(subject_user_id: @instructor&.id).delete_all
    CohortInstructorAssignment.where(id: @assignment&.id).delete_all
    ContentBlock.where(lesson_id: @lesson&.id).delete_all
    Lesson.where(id: @lesson&.id).delete_all
    CurriculumModule.where(id: @module&.id).delete_all
    (@joined.to_a + [ @cohort, @other_cohort ]).compact.each { |cohort| Cohort.find_by(id: cohort.id)&.destroy! }
    Curriculum.find_by(id: @curriculum&.id)&.destroy!
    Curriculum.find_by(id: @other_curriculum&.id)&.destroy!
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

  # Changes to which cohorts use the curriculum, run on a second connection.
  MEMBERSHIP_CHANGES = {
    "a new cohort on the curriculum" => [ "curriculum_shared", ->(t) { t.joined << Cohort.create!(name: "Joined #{SecureRandom.hex(3)}", curriculum: t.curriculum, start_date: Date.current, status: :upcoming) } ],
    "another curriculum's cohort moving onto it" => [ "curriculum_shared", ->(t) { Cohort.find(t.other_cohort.id).update!(curriculum_id: t.curriculum.id) } ],
    "the instructor's granted cohort moving off it" => [ "lesson_editing_not_granted", ->(t) { Cohort.find(t.cohort.id).update!(curriculum_id: t.other_curriculum.id) } ]
  }.freeze

  attr_reader :curriculum, :other_curriculum, :cohort, :other_cohort, :joined

  MEMBERSHIP_CHANGES.each do |label, (code, change)|
    test "#{label} waits for a save already past its access check, and later saves are refused" do
      ApplicationRecord.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        LessonEditAccess.authorize!(@instructor, @curriculum, lock: true)
        @lesson.with_authoring_lock { @block.update!(body: "Saved by the instructor") }

        @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { change.call(self) } }
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      Timeout.timeout(60) { @threads.first.value }
      assert_equal "Saved by the instructor", @block.reload.body
      error = assert_raises(LessonEditAccess::Denied) do
        ApplicationRecord.transaction { LessonEditAccess.authorize!(@instructor, @curriculum, lock: true) }
      end
      assert_equal code, error.code
    end

    test "a save that starts while #{label} is uncommitted waits for it and is refused" do
      result = nil
      ApplicationRecord.transaction do
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        change.call(self)

        @threads << Thread.new do
          ActiveRecord::Base.connection_pool.with_connection do
            ApplicationRecord.transaction do
              LessonEditAccess.authorize!(@instructor, @curriculum, lock: true)
              @lesson.with_authoring_lock { ContentBlock.find(@block.id).update!(body: "Saved after the change") }
            end
            :saved
          rescue LessonEditAccess::Denied => error
            error.code
          end
        end
        wait_for_lock_waiters(holder_pid, workers: @threads)
      end

      assert_equal code, Timeout.timeout(60) { @threads.first.value }
      assert_equal "Before", @block.reload.body
    end
  end

  test "a duplicate and a move of the same lesson don't deadlock" do
    target = CurriculumModule.create!(curriculum: @curriculum, name: "Target", position: 1, day_offset: 0, schedule_days: "weekdays")
    copy = nil
    lesson = Lesson.find(@lesson.id)
    move = Thread.new do
      Thread.stop
      ActiveRecord::Base.connection_pool.with_connection do
        LessonMove.new(lesson: Lesson.find(@lesson.id), module_id: target.id, release_day: 0, position: 0, base_updated_at: lesson.updated_at.iso8601(6)).move!
        :moved
      rescue StandardError => error
        error.class.name
      end
    end
    @threads << move
    test_case = self
    # Pause the duplicate once it holds the original lesson, and let the move
    # start then: it must queue behind the duplicate as a whole (curriculum
    # first) instead of taking the module the duplicate still needs.
    lesson.define_singleton_method(:reload) do |*args|
      unless @paused
        @paused = true
        holder_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
        Thread.pass until move.stop?
        move.wakeup
        test_case.wait_for_lock_waiters(holder_pid, workers: [ move ])
      end
      super(*args)
    end

    copy = LessonDuplicate.new(lesson: lesson, user: @admin).duplicate!

    assert_equal :moved, Timeout.timeout(60) { move.value }
    assert_equal target.id, @lesson.reload.module_id
    assert_equal @module.id, copy.reload.module_id
  ensure
    if copy
      ContentBlock.where(lesson_id: copy.id).delete_all
      Lesson.where(id: copy.id).delete_all
    end
    Lesson.where(id: @lesson&.id).update_all(module_id: @module.id)
    CurriculumModule.where(id: target&.id).delete_all
  end
end
