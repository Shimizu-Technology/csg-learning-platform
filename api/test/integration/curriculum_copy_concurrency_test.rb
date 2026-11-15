require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# Two connections: learners keep working while "Make a copy for this cohort"
# runs (CurriculumCopyForCohort). The copy holds the cohort, its enrollments
# and the curriculum's blocks until it commits, so a learner write in flight
# waits, then is refused with "reload" (code content_moved) rather than saved
# on the shared block; the retry, with the same old id, saves on the copy.
# A help request asked meanwhile waits on the cohort and is saved on the copy.
class CurriculumCopyConcurrencyTest < ActionDispatch::IntegrationTest
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
    @curriculum = Curriculum.create!(name: "Copy race #{slug}", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week one", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Intro", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Read it.")
    @cohort = Cohort.create!(name: "Copy race 3 #{slug}", curriculum: @curriculum, start_date: Date.current - 30, status: :active)
    @other = Cohort.create!(name: "Copy race 4 #{slug}", curriculum: @curriculum, start_date: Date.current - 30, status: :active)
    @admin = User.create!(clerk_id: "copy_race_admin_#{slug}", email: "copy-race-admin-#{slug}@example.invalid", role: :admin, first_name: "Ada")
    @student = User.create!(clerk_id: "copy_race_#{slug}", email: "copy-race-#{slug}@example.invalid", role: :student, first_name: "Sam")
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @module, unlocked: true)
    @threads = []
  end

  teardown do
    AfterLearnerCheck.callback = nil
    CurriculumCopyForCohort.stage_hook = nil
    finish_test_threads(@threads)
    copies = CurriculumCopy.where(cohort_id: @cohort&.id)
    curricula = [ @curriculum&.id, *copies.pluck(:copy_curriculum_id) ].compact
    ContentRedirect.where(cohort_id: @cohort&.id).delete_all
    copies.delete_all
    ActivityEvent.where(cohort_id: [ @cohort&.id, @other&.id ]).delete_all
    Notification.where(user_id: [ @student&.id, @admin&.id ]).delete_all
    HelpRequest.where(cohort_id: @cohort&.id).delete_all
    Progress.where(user_id: @student&.id).delete_all
    ModuleAssignment.where(enrollment_id: @enrollment&.id).delete_all
    Enrollment.find_by(id: @enrollment&.id)&.destroy!
    lesson_ids = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curricula }).ids
    ContentBlock.where(lesson_id: lesson_ids).delete_all
    Lesson.where(id: lesson_ids).delete_all
    CurriculumModule.where(curriculum_id: curricula).delete_all
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Cohort.find_by(id: @other&.id)&.destroy!
    Curriculum.where(id: curricula).delete_all
    delete_test_users(@student, @admin)
  end

  test "a learner save waiting on the copy is refused with reload, and the retry saves on the copy" do
    request_thread = Thread.current
    started = Queue.new
    AfterLearnerCheck.callback = lambda do
      @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { copy_holding_until_waited_on(request_thread, started) } }
      # The learner's early check passed against the shared block; the copy
      # now takes its locks before the learner's write takes the enrollment.
      Timeout.timeout(30) { started.pop }
    end

    complete_block(@block.id)

    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    assert_response :conflict
    assert_equal "content_moved", response.parsed_body["code"]
    refute Progress.exists?(content_block_id: @block.id), "nothing was saved on the shared block"

    # The app reloads and saves again with the id it had: it lands on the copy.
    complete_block(@block.id)
    assert_response :success
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "ContentBlock", old_id: @block.id).new_id
    assert_equal copied, response.parsed_body.dig("progress", "content_block_id")
    assert Progress.exists?(enrollment_id: @enrollment.id, content_block_id: copied, status: Progress.statuses.fetch("completed"))
  end

  test "a help request asked during the copy waits for it and is saved on the copy" do
    request_thread = Thread.current
    started = Queue.new
    @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { copy_holding_until_waited_on(request_thread, started) } }
    Timeout.timeout(30) { started.pop }

    as_student do
      post "/api/v1/help_requests", params: { cohort_id: @cohort.id, context_type: "lesson", context_id: @lesson.id, category: "concept", message: "Stuck" }, headers: auth_headers, as: :json
    end

    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    assert_response :created
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "Lesson", old_id: @lesson.id).new_id
    assert_equal copied, HelpRequest.find(response.parsed_body.dig("help_request", "id")).context_id
  end

  private

  # Copies, and once the copy holds every lock and has verified progress,
  # waits until the request thread is blocked on it before committing.
  def copy_holding_until_waited_on(request_thread, started)
    pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
    CurriculumCopyForCohort.stage_hook = lambda do |stage|
      next unless stage == :verified

      started << :holding
      wait_for_lock_waiters(pid, workers: [ request_thread ])
    end
    CurriculumCopyForCohort.new(cohort: Cohort.find(@cohort.id), user: User.find(@admin.id), source_curriculum_id: @curriculum.id).copy!
    :committed
  ensure
    CurriculumCopyForCohort.stage_hook = nil
  end

  def complete_block(block_id)
    as_student { patch "/api/v1/progress", params: { content_block_id: block_id, status: "completed" }, headers: auth_headers, as: :json }
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_student
    payload = { "sub" => @student.clerk_id, "email" => @student.email, "first_name" => @student.first_name, "last_name" => @student.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
