require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# A learner's save is authorized before it takes its block lock. A lesson
# move that commits in between (or that holds the lesson's blocks while the
# save waits) can leave the lesson where the learner can't open it. The save
# then decides again under its block lock (ApplicationController#
# recheck_content_block_write!) and records nothing.
class LearnerWriteAfterMoveConcurrencyTest < ActionDispatch::IntegrationTest
  self.use_transactional_tests = false
  include NonTransactionalTestCleanup
  include LockWaitHelpers

  # Runs `callback` (when set) once the learner's early check has passed.
  module AfterLearnerCheck
    mattr_accessor :callback

    def authorize_content_block_write!(content_block)
      result = super
      unless performed?
        callback = AfterLearnerCheck.callback
        AfterLearnerCheck.callback = nil
        callback&.call
      end
      result
    end
  end

  Api::V1::ProgressController.prepend(AfterLearnerCheck) unless Api::V1::ProgressController.ancestors.include?(AfterLearnerCheck)

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Learner race #{slug}")
    @cohort = Cohort.create!(name: "Learner race class #{slug}", curriculum: @curriculum, start_date: Date.current - 30, status: :active)
    @source = CurriculumModule.create!(curriculum: @curriculum, name: "Source", position: 0, day_offset: 0, schedule_days: "weekdays")
    @target = CurriculumModule.create!(curriculum: @curriculum, name: "Target", position: 1, day_offset: 7, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @source, title: "Lesson", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Read it.")
    @student = User.create!(clerk_id: "learner_race_#{slug}", email: "learner-race-#{slug}@example.invalid", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @source, unlocked: true)
    @threads = []
  end

  teardown do
    AfterLearnerCheck.callback = nil
    finish_test_threads(@threads)
    ActivityEvent.where(subject_user_id: @student&.id).delete_all
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

  test "a move committed after the learner's check refuses the save" do
    AfterLearnerCheck.callback = lambda do
      @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { move! } }
      Timeout.timeout(30) { @threads.last.value }
    end

    complete_block

    assert_nil AfterLearnerCheck.callback, "the move ran after the early check"
    assert_response :forbidden
    assert_equal @target.id, @lesson.reload.module_id
    refute Progress.exists?(content_block_id: @block.id)
  end

  test "a save waiting on a move's block lock decides again once the move commits" do
    moved = Queue.new
    request_thread = Thread.current
    AfterLearnerCheck.callback = lambda do
      @threads << Thread.new do
        ActiveRecord::Base.connection_pool.with_connection do
          Lesson.transaction do
            pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
            move!
            moved << :moved
            # Commit only once the learner's save is waiting on the blocks.
            wait_for_lock_waiters(pid, workers: [ request_thread ])
          end
          :committed
        end
      end
      Timeout.timeout(30) { moved.pop }
    end

    complete_block

    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    assert_response :forbidden
    assert_equal @target.id, @lesson.reload.module_id
    refute Progress.exists?(content_block_id: @block.id)
  end

  test "without a move the save goes through" do
    complete_block

    assert_response :success
    assert Progress.exists?(content_block_id: @block.id, enrollment_id: @enrollment.id, status: Progress.statuses.fetch("completed"))
  end

  private

  def move!
    LessonMove.new(lesson: Lesson.find(@lesson.id), module_id: @target.id, release_day: 7, position: 0,
                   base_updated_at: Lesson.find(@lesson.id).updated_at.iso8601(6)).move!
  end

  def complete_block
    payload = { "sub" => @student.clerk_id, "email" => @student.email, "first_name" => @student.first_name, "last_name" => @student.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    patch "/api/v1/progress", params: { content_block_id: @block.id, status: "completed" }, headers: { "Authorization" => "Bearer test_token" }, as: :json
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
