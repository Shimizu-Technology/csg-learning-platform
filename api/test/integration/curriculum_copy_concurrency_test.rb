require "test_helper"
require_relative "../support/non_transactional_test_cleanup"
require_relative "../support/lock_wait_helpers"
require "timeout"

# Two connections: learners keep working while "Make a copy for this cohort"
# runs (CurriculumCopyForCohort). The copy holds the cohort and its
# enrollments until it commits, so a learner write that arrives during the
# copy waits, then is refused with "reload" (code content_moved) rather than
# saved on the shared block; the retry, with the same old id, saves on the
# copy. A learner write already holding its enrollment when the copy starts
# finishes first, and the copy then moves its row (no deadlock: the copy
# takes the cohort FOR NO KEY UPDATE, which the activity event's foreign key
# check doesn't wait for). A help request asked meanwhile waits on the cohort
# and is saved on the copy. Learners in other cohorts on the shared
# curriculum don't wait for the copy at all.
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

  # Runs `callback` (when set) inside a learner write, once it holds its
  # enrollment and before it writes anything.
  module InsideLearnerGuard
    mattr_accessor :callback

    def with_learning_write_guard(request_started_at:)
      super(request_started_at: request_started_at) do
        callback = InsideLearnerGuard.callback
        InsideLearnerGuard.callback = nil
        callback&.call
        yield
      end
    end
  end

  Enrollment.prepend(InsideLearnerGuard) unless Enrollment.ancestors.include?(InsideLearnerGuard)

  # Runs `callback` (when set) once a help request holds the cohort.
  module InsideHelpRequest
    mattr_accessor :callback

    def resolve!(**)
      callback = InsideHelpRequest.callback
      InsideHelpRequest.callback = nil
      callback&.call
      super
    end
  end

  HelpRequestContext.singleton_class.prepend(InsideHelpRequest) unless HelpRequestContext.singleton_class.ancestors.include?(InsideHelpRequest)

  # Staff writes resolve a cohort's module (or a learner's enrollment) before
  # they take any lock. `AfterLookup.callback` runs right there.
  module AfterLookup
    mattr_accessor :callback

    def self.run
      callback = self.callback
      self.callback = nil
      callback&.call
    end

    def self.pause_after(klass, method_name)
      return if klass.ancestors.any? { |mod| mod.instance_variable_get(:@pause_after) == method_name }

      hook = Module.new do
        define_method(method_name) do |*args, **options, &block|
          result = super(*args, **options, &block)
          AfterLookup.run
          result
        end
        private method_name
      end
      hook.instance_variable_set(:@pause_after, method_name)
      klass.prepend(hook)
    end
  end

  AfterLookup.pause_after(Api::V1::CohortModuleSubmissionWindowsController, :set_module)
  AfterLookup.pause_after(Api::V1::CohortsController, :normalized_module_start_date)
  AfterLookup.pause_after(Api::V1::CohortGradingController, :set_module)
  AfterLookup.pause_after(Api::V1::ModuleAssignmentsController, :authorize_enrollment_cohort!)
  AfterLookup.pause_after(Api::V1::LessonAssignmentsController, :authorize_enrollment_cohort!)
  AfterLookup.pause_after(Api::V1::LearningPlansController, :set_enrollment)
  AfterLookup.pause_after(Api::V1::SubmissionsController, :requested_grading_base_updated_at)

  # Runs `callback` (when set) once a submission window save holds the cohort.
  module InsideCohortLock
    mattr_accessor :callback

    private

    def lock_cohort_for_module_write!(*)
      super
      callback = InsideCohortLock.callback
      InsideCohortLock.callback = nil
      callback&.call
    end
  end

  Api::V1::CohortModuleSubmissionWindowsController.prepend(InsideCohortLock) unless Api::V1::CohortModuleSubmissionWindowsController.ancestors.include?(InsideCohortLock)

  # Runs `before` (when set) just before, and `after` just after, the next
  # Cohort#lock! (with_lock uses it): a bulk enrollment's or a settings
  # save's cohort lock.
  module AroundCohortLock
    mattr_accessor :before, :after

    def lock!(*args, **options)
      callback = AroundCohortLock.before
      AroundCohortLock.before = nil
      callback&.call
      result = super
      callback = AroundCohortLock.after
      AroundCohortLock.after = nil
      callback&.call
      result
    end
  end

  Cohort.prepend(AroundCohortLock) unless Cohort.ancestors.include?(AroundCohortLock)

  # GitHub, answered locally: every requested file has a solution.
  module LocalGithub
    def fetch_exercise_files(_owner, _repo_name, filenames)
      { files: filenames.map { |name| { "name" => name, "text" => "puts 'synced'" } }, commit_hash: "abc123", error: nil }
    end
  end

  GithubSyncService.prepend(LocalGithub) unless GithubSyncService.ancestors.include?(LocalGithub)

  # Each learner write path: the block (or check) it writes on, and the row
  # it leaves.
  WRITES = {
    progress: [ "ContentBlock", :@block ],
    video_credit: [ "ContentBlock", :@video ],
    checkpoint: [ "KnowledgeCheck", :@check ],
    submission: [ "ContentBlock", :@exercise ]
  }.freeze

  setup do
    slug = SecureRandom.hex(4)
    @curriculum = Curriculum.create!(name: "Copy race #{slug}", status: :active)
    @module = CurriculumModule.create!(curriculum: @curriculum, name: "Week one", position: 0, day_offset: 0, schedule_days: "weekdays")
    @lesson = Lesson.create!(curriculum_module: @module, title: "Intro", position: 0, release_day: 0)
    @block = @lesson.content_blocks.create!(block_type: :text, position: 0, title: "Read", body: "Read it.")
    @video = @lesson.content_blocks.create!(block_type: :video, position: 1, title: "Watch", video_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    check_block = @lesson.content_blocks.create!(block_type: :checkpoint, position: 2, title: "Check")
    @check = KnowledgeCheck.create!(content_block: check_block, prompt: "Pick one", options: [ "Yes", "No" ], correct_option: 0, explanation: "Yes.")
    @exercise = @lesson.content_blocks.create!(block_type: :exercise, position: 3, title: "Build it", submission_type: :text_submission)
    @cohort = Cohort.create!(name: "Copy race 3 #{slug}", curriculum: @curriculum, start_date: Date.current - 30, status: :active)
    @other = Cohort.create!(name: "Copy race 4 #{slug}", curriculum: @curriculum, start_date: Date.current - 30, status: :active)
    @admin = User.create!(clerk_id: "copy_race_admin_#{slug}", email: "copy-race-admin-#{slug}@example.invalid", role: :admin, first_name: "Ada")
    @student = User.create!(clerk_id: "copy_race_#{slug}", email: "copy-race-#{slug}@example.invalid", role: :student, first_name: "Sam")
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @module, unlocked: true)
    @other_student = User.create!(clerk_id: "copy_race_other_#{slug}", email: "copy-race-other-#{slug}@example.invalid", role: :student, first_name: "Olu")
    @other_enrollment = Enrollment.create!(user: @other_student, cohort: @other, status: :active)
    ModuleAssignment.create!(enrollment: @other_enrollment, curriculum_module: @module, unlocked: true)
    @threads = []
  end

  teardown do
    AfterLookup.callback = nil
    InsideCohortLock.callback = nil
    AfterLearnerCheck.callback = nil
    InsideLearnerGuard.callback = nil
    InsideHelpRequest.callback = nil
    AroundCohortLock.before = nil
    AroundCohortLock.after = nil
    CurriculumCopyForCohort.stage_hook = nil
    CurriculumCopyForCohort.lock_timeout = "5s"
    finish_test_threads(@threads)
    newcomers = @newcomer_email ? User.where(email: @newcomer_email).to_a : []
    newcomer_enrollments = Enrollment.where(user_id: newcomers.map(&:id))
    ModuleAssignment.where(enrollment_id: newcomer_enrollments.select(:id)).delete_all
    newcomer_enrollments.each(&:destroy!)
    copies = CurriculumCopy.where(cohort_id: @cohort&.id)
    curricula = [ @curriculum&.id, *copies.pluck(:copy_curriculum_id) ].compact
    ContentRedirect.where(cohort_id: @cohort&.id).delete_all
    copies.delete_all
    ActivityEvent.where(cohort_id: [ @cohort&.id, @other&.id ]).delete_all
    students = [ @student&.id, @other_student&.id ]
    Notification.where(user_id: [ *students, @admin&.id, @settings_admin&.id ]).delete_all
    HelpRequest.where(cohort_id: @cohort&.id).delete_all
    CohortModuleSubmissionWindow.where(cohort_id: [ @cohort&.id, @other&.id ]).delete_all
    CohortModuleSchedule.where(cohort_id: [ @cohort&.id, @other&.id ]).delete_all
    LearningPlan.where(enrollment_id: @enrollment&.id).destroy_all
    LessonAssignment.where(enrollment_id: [ @enrollment&.id, @other_enrollment&.id ]).delete_all
    Progress.where(user_id: students).delete_all
    KnowledgeCheckAttempt.where(user_id: students).delete_all
    SubmissionCriterionResult.where(submission_id: Submission.where(user_id: students).select(:id)).delete_all
    Submission.where(user_id: students).delete_all
    ModuleAssignment.where(enrollment_id: [ @enrollment&.id, @other_enrollment&.id ]).delete_all
    Enrollment.find_by(id: @enrollment&.id)&.destroy!
    Enrollment.find_by(id: @other_enrollment&.id)&.destroy!
    lesson_ids = Lesson.joins(:curriculum_module).where(modules: { curriculum_id: curricula }).ids
    KnowledgeCheck.where(content_block_id: ContentBlock.where(lesson_id: lesson_ids).select(:id)).delete_all
    ContentBlock.where(lesson_id: lesson_ids).delete_all
    Lesson.where(id: lesson_ids).delete_all
    CurriculumModule.where(curriculum_id: curricula).delete_all
    Cohort.find_by(id: @cohort&.id)&.destroy!
    Cohort.find_by(id: @other&.id)&.destroy!
    Curriculum.where(id: curricula).delete_all
    delete_test_users(@student, @other_student, @admin, @settings_admin, newcomers)
  end

  # Learner first: the write holds its enrollment when the copy starts. The
  # copy waits for it (it needs that enrollment) rather than deadlocking, the
  # write saves on the shared ids, and the copy then moves the row.
  WRITES.each do |kind, (record_type, ivar)|
    test "learner first: a #{kind.to_s.tr('_', ' ')} save holding its enrollment finishes, then the copy moves it" do
      InsideLearnerGuard.callback = -> { start_copy_and_wait_until_it_waits_on_this_request }

      learner_write(kind)

      assert_includes [ 200, 201 ], response.status, response.body
      assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
      old_id = instance_variable_get(ivar).id
      copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: record_type, old_id: old_id).new_id
      assert_equal [ copied ], learner_rows(kind, @enrollment), "the row saved before the copy moved to the copy"
    end

    next if kind == :progress # "copy first" for progress is the test below

    test "copy first: a #{kind.to_s.tr('_', ' ')} save waits for the copy and is refused with reload" do
      start_copy_holding_until_waited_on

      learner_write(kind)

      assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
      assert_response :conflict
      assert_equal "content_moved", response.parsed_body["code"]
      assert_empty learner_rows(kind, @enrollment)

      learner_write(kind)
      assert_includes [ 200, 201 ], response.status, response.body
      copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: record_type, old_id: instance_variable_get(ivar).id).new_id
      assert_equal [ copied ], learner_rows(kind, @enrollment)
    end
  end

  test "learner first: a help request holding the cohort finishes, then the copy moves it" do
    InsideHelpRequest.callback = -> { start_copy_and_wait_until_it_waits_on_this_request }

    ask_for_help

    assert_response :created
    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "Lesson", old_id: @lesson.id).new_id
    assert_equal copied, HelpRequest.find(response.parsed_body.dig("help_request", "id")).context_id
  end

  test "a learner in another cohort on the shared curriculum doesn't wait for the copy" do
    release = Queue.new
    started = Queue.new
    @threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        CurriculumCopyForCohort.stage_hook = lambda do |stage|
          next unless stage == :verified

          started << :holding
          Timeout.timeout(30) { release.pop }
        end
        CurriculumCopyForCohort.new(cohort: Cohort.find(@cohort.id), user: User.find(@admin.id), source_curriculum_id: @curriculum.id).copy!
        :committed
      rescue StandardError => error
        error
      ensure
        CurriculumCopyForCohort.stage_hook = nil
      end
    end
    Timeout.timeout(30) { started.pop }

    # A lock wait here would mean the copy blocks other cohorts' learners.
    connection = ActiveRecord::Base.connection
    connection.execute("SET lock_timeout = '2s'")
    begin
      %i[progress video_credit checkpoint submission].each do |kind|
        learner_write(kind, student: @other_student)
        assert_includes [ 200, 201 ], response.status, "#{kind}: #{response.body}"
      end
    ensure
      connection.execute("RESET lock_timeout")
    end
    assert @threads.last.alive?, "the copy was still holding its locks"

    release << :go
    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    assert_equal [ @block.id ], learner_rows(:progress, @other_enrollment), "the other cohort's work stays on the shared blocks"
    assert_equal [ @check.id ], learner_rows(:checkpoint, @other_enrollment)
  end

  test "a copy that waits too long on someone else's lock rolls back and answers busy, and a retry copies" do
    CurriculumCopyForCohort.lock_timeout = "300ms"
    holding = Queue.new
    release = Queue.new
    # An author saving a block of the shared curriculum (FOR NO KEY UPDATE).
    @threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        ApplicationRecord.transaction do
          ContentBlock.lock_for_authoring!([ @block.id ])
          holding << :holding
          Timeout.timeout(30) { release.pop }
        end
        :released
      end
    end
    Timeout.timeout(30) { holding.pop }

    as_user(@admin) { post "/api/v1/cohorts/#{@cohort.id}/curriculum_copy", params: { source_curriculum_id: @curriculum.id }, headers: auth_headers, as: :json }

    assert_response :conflict
    assert_equal "busy", response.parsed_body["code"]
    assert_match "Try again", response.parsed_body["error"]
    assert_equal @curriculum.id, @cohort.reload.curriculum_id
    refute CurriculumCopy.exists?(cohort_id: @cohort.id)
    assert_nil @enrollment.reload.content_moved_at

    release << :go
    assert_equal :released, Timeout.timeout(30) { @threads.last.value }
    as_user(@admin) { post "/api/v1/cohorts/#{@cohort.id}/curriculum_copy", params: { source_curriculum_id: @curriculum.id }, headers: auth_headers, as: :json }
    assert_response :created
    refute_equal @curriculum.id, @cohort.reload.curriculum_id
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

    ask_for_help

    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    assert_response :created
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "Lesson", old_id: @lesson.id).new_id
    assert_equal copied, HelpRequest.find(response.parsed_body.dig("help_request", "id")).context_id
  end

  # Staff writes ---------------------------------------------------------------

  # The review's repro: a submission window save resolved the cohort's module,
  # then a copy committed (moving the cohort and any windows to the copy).
  # The save takes the cohort lock, sees the cohort moved, and is refused
  # rather than saving a deadline on the shared module nobody uses.
  { "a new window" => nil, "a change to an existing window" => "2026-12-04T09:00:00Z" }.each do |label, existing_close|
    test "copy first: #{label} saved during the copy is refused with reload, and the copy keeps the windows it moved" do
      CohortModuleSubmissionWindow.create!(cohort: @cohort, curriculum_module: @module, week_number: 1, submissions_close_at: Time.iso8601(existing_close)) if existing_close
      AfterLookup.callback = -> { run_copy_to_commit }

      save_window("2026-12-11T09:00:00Z")

      assert_response :conflict
      assert_equal "content_moved", response.parsed_body["code"]
      assert_match "Reload, then save again", response.parsed_body["error"]
      copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "CurriculumModule", old_id: @module.id).new_id
      assert_empty windows(@module.id), "nothing was saved on the shared module"
      assert_equal (existing_close ? [ [ 1, Time.iso8601(existing_close) ] ] : []), windows(copied)
    end
  end

  test "save first: a window save holding the cohort finishes, then the copy moves the new window" do
    InsideCohortLock.callback = -> { start_copy_and_wait_until_it_waits_on_this_request }

    save_window("2026-12-11T09:00:00Z")

    assert_response :success
    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "CurriculumModule", old_id: @module.id).new_id
    assert_empty windows(@module.id)
    assert_equal [ [ 1, Time.iso8601("2026-12-11T09:00:00Z") ] ], windows(copied)
  end

  # Every other staff write naming a cohort's content: the copy commits after
  # the request resolved its ids and before it saved. Each is refused with
  # reload, and nothing lands on the shared ids.
  {
    "module access" => lambda do |test|
      test.instance_eval do
        as_user(@admin) { patch "/api/v1/cohorts/#{@cohort.id}/module_access", params: { module_id: @module.id, assigned: true, unlocked: false }, headers: auth_headers, as: :json }
        -> { assert_nil @cohort.reload.content_defaults[@module.id.to_s], "no defaults for the shared module" }
      end
    end,
    "a learner's module override" => lambda do |test|
      test.instance_eval do
        as_user(@admin) { post "/api/v1/enrollments/#{@enrollment.id}/module_assignments", params: { module_id: @module.id, unlocked: false }, headers: auth_headers, as: :json }
        -> { assert_empty ModuleAssignment.where(enrollment_id: @enrollment.id, module_id: @module.id) }
      end
    end,
    "a learner's lesson override" => lambda do |test|
      test.instance_eval do
        as_user(@admin) { post "/api/v1/enrollments/#{@enrollment.id}/lesson_assignments", params: { lesson_id: @lesson.id, unlocked: true }, headers: auth_headers, as: :json }
        -> { assert_empty LessonAssignment.where(enrollment_id: @enrollment.id) }
      end
    end,
    "a learning plan" => lambda do |test|
      test.instance_eval do
        plan = { active: true, title: "Catch up", milestones: [ { title: "Intro", due_on: (Date.current + 7).iso8601, lesson_ids: [ @lesson.id ] } ] }
        as_user(@admin) { patch "/api/v1/enrollments/#{@enrollment.id}/learning_plan", params: { learning_plan: plan }, headers: auth_headers, as: :json }
        -> { assert_nil LearningPlan.find_by(enrollment_id: @enrollment.id) }
      end
    end,
    "grading" => lambda do |test|
      test.instance_eval do
        submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "Answer", num_submissions: 1)
        as_user(@admin) do
          patch "/api/v1/submissions/#{submission.id}/grade", params: { grade: "A", feedback: "Good", base_submission_updated_at: submission.updated_at.iso8601(6) }, headers: auth_headers, as: :json
        end
        -> { assert_nil submission.reload.grade }
      end
    end,
    "a GitHub sync" => lambda do |test|
      test.instance_eval do
        @synced = @lesson.content_blocks.create!(block_type: :exercise, position: 4, title: "Sync it", filename: "sync_it.rb")
        @cohort.update_columns(repository_name: "prework", settings: { "module_github_config" => { @module.id.to_s => { "requires_github" => true } } })
        @student.update_columns(github_username: "copy-race-#{@student.id}")
        with_github_token { as_user(@admin) { post "/api/v1/cohorts/#{@cohort.id}/modules/#{@module.id}/sync_github", headers: auth_headers, as: :json } }
        -> { assert_empty Submission.where(content_block_id: @synced.id), "nothing synced onto the shared block" }
      end
    end
  }.each do |write, request|
    test "copy first: #{write} saved during the copy is refused with reload" do
      AfterLookup.callback = -> { run_copy_to_commit }

      check = request.call(self)

      assert_response :conflict
      assert_equal "content_moved", response.parsed_body["code"], response.body
      refute_equal @curriculum.id, @cohort.reload.curriculum_id, "the copy committed"
      check.call
    end
  end

  # Bulk enrollment (#275) ----------------------------------------------------

  # The copy commits after the bulk request loaded the cohort and before it
  # took the cohort lock. The new learner's module assignments come from the
  # cohort's copy, never the shared modules the request saw first.
  test "copy first: a bulk enrollment waiting for the cohort assigns the copy's modules" do
    AroundCohortLock.before = -> { run_copy_to_commit }

    bulk_enroll

    assert_response :success
    assert_equal "enrolled", response.parsed_body["results"].sole["status"], response.body
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "CurriculumModule", old_id: @module.id).new_id
    assert_equal [ copied ], newcomer_module_ids
    assert_equal [ copied.to_s ], @cohort.reload.content_defaults.keys
  end

  # The bulk request holds the cohort when the copy starts: the copy waits
  # for it, then moves the new learner's assignments with everyone else's.
  test "bulk first: an enrollment holding the cohort finishes, then the copy moves its module assignments" do
    AroundCohortLock.after = -> { start_copy_and_wait_until_it_waits_on_this_request }

    bulk_enroll

    assert_response :success
    assert_equal "enrolled", response.parsed_body["results"].sole["status"], response.body
    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    copied = ContentRedirect.find_by!(cohort_id: @cohort.id, record_type: "CurriculumModule", old_id: @module.id).new_id
    assert_equal [ copied ], newcomer_module_ids
  end

  # Cohort settings (#275 takes the cohort lock there) ------------------------

  # A status change locks the cohort's curriculum (Cohort#lock_curriculum_for_availability).
  # The settings save takes it before the cohort, as the copy does, so a copy
  # arriving meanwhile waits instead of deadlocking.
  test "settings first: a status change holding the cohort finishes, then the copy runs" do
    AroundCohortLock.after = -> { start_copy_and_wait_until_it_waits_on_this_request }

    save_status("completed")

    assert_response :success
    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    cohort = @cohort.reload
    assert_equal "completed", cohort.status
    refute_equal @curriculum.id, cohort.curriculum_id
  end

  test "copy first: a settings save waiting on the copy is refused with reload, and the retry saves" do
    # Another admin: the copy's audit rows hold its author's user row
    # FOR KEY SHARE, which that author's own sign-in (FOR UPDATE) would wait
    # for before the request even loads the cohort.
    @settings_admin = User.create!(clerk_id: "copy_race_settings_#{SecureRandom.hex(4)}", email: "copy-race-settings-#{SecureRandom.hex(4)}@example.invalid", role: :admin, first_name: "Sol")
    start_copy_holding_until_waited_on

    save_status("completed", as: @settings_admin)

    assert_equal :committed, Timeout.timeout(30) { @threads.last.value }
    assert_response :conflict
    assert_equal "content_moved", response.parsed_body["code"]
    assert_equal "active", @cohort.reload.status

    save_status("completed", as: @settings_admin)
    assert_response :success
    assert_equal "completed", @cohort.reload.status
  end

  private

  def bulk_enroll
    @newcomer_email = "copy-race-new-#{SecureRandom.hex(4)}@example.invalid"
    as_user(@admin) { post "/api/v1/cohorts/#{@cohort.id}/enrollments/bulk", params: { rows: [ { email: @newcomer_email } ] }, headers: auth_headers, as: :json }
  end

  def newcomer_module_ids
    ModuleAssignment.joins(enrollment: :user).where(users: { email: @newcomer_email }, enrollments: { cohort_id: @cohort.id }).pluck(:module_id)
  end

  def save_status(status, as: @admin)
    as_user(as) { patch "/api/v1/cohorts/#{@cohort.id}", params: { status: status }, headers: auth_headers, as: :json }
  end

  # Runs the whole copy on another connection and returns once it committed.
  def run_copy_to_commit
    thread = Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        CurriculumCopyForCohort.new(cohort: Cohort.find(@cohort.id), user: User.find(@admin.id), source_curriculum_id: @curriculum.id).copy!
        :committed
      rescue StandardError => error
        error
      end
    end
    @threads << thread
    assert_equal :committed, Timeout.timeout(30) { thread.value }
  end

  def save_window(close_at)
    as_user(@admin) do
      patch "/api/v1/cohorts/#{@cohort.id}/modules/#{@module.id}/submission_windows",
        params: { submission_windows: [ { week_number: 1, submissions_close_at: close_at } ] }, headers: auth_headers, as: :json
    end
  end

  def windows(module_id)
    CohortModuleSubmissionWindow.where(cohort_id: @cohort.id, module_id: module_id).order(:week_number).pluck(:week_number, :submissions_close_at)
  end

  def with_github_token
    original = ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"]
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = "test-token"
    yield
  ensure
    ENV["GITHUB_ORGANIZATION_ADMIN_TOKEN"] = original
  end

  # Called on the request thread inside a learner transaction: starts the
  # copy on another connection and returns once the copy is waiting on a lock
  # this transaction holds.
  def start_copy_and_wait_until_it_waits_on_this_request
    learner_pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
    @threads << Thread.new do
      ActiveRecord::Base.connection_pool.with_connection do
        CurriculumCopyForCohort.new(cohort: Cohort.find(@cohort.id), user: User.find(@admin.id), source_curriculum_id: @curriculum.id).copy!
        :committed
      rescue StandardError => error
        error
      end
    end
    wait_for_lock_waiters(learner_pid, workers: [ @threads.last ], timeout: 30)
  end

  def start_copy_holding_until_waited_on
    request_thread = Thread.current
    started = Queue.new
    @threads << Thread.new { ActiveRecord::Base.connection_pool.with_connection { copy_holding_until_waited_on(request_thread, started) } }
    Timeout.timeout(30) { started.pop }
  end

  def learner_write(kind, student: @student)
    as_user(student) do
      case kind
      when :progress
        patch "/api/v1/progress", params: { content_block_id: @block.id, status: "completed" }, headers: auth_headers, as: :json
      when :video_credit
        patch "/api/v1/content_blocks/#{@video.id}/video_progress", params: { last_position_seconds: 30, total_watched_seconds: 30, duration_seconds: 300 }, headers: auth_headers, as: :json
      when :checkpoint
        post "/api/v1/knowledge_checks/#{@check.id}/attempts", params: { selected_option: 0 }, headers: auth_headers, as: :json
      when :submission
        post "/api/v1/submissions", params: { content_block_id: @exercise.id, text: "My answer" }, headers: auth_headers, as: :json
      end
    end
  end

  # The content ids the learner's rows for this write sit on.
  def learner_rows(kind, enrollment)
    case kind
    when :progress then Progress.where(enrollment_id: enrollment.id, status: Progress.statuses.fetch("completed")).where.not(content_block_id: video_and_check_block_ids).pluck(:content_block_id).uniq
    when :video_credit then Progress.where(enrollment_id: enrollment.id).where("video_total_watched > 0").pluck(:content_block_id)
    when :checkpoint then KnowledgeCheckAttempt.where(enrollment_id: enrollment.id).pluck(:knowledge_check_id)
    when :submission then Submission.where(enrollment_id: enrollment.id).pluck(:content_block_id)
    end
  end

  # Progress on the checkpoint and exercise blocks comes from those writes.
  def video_and_check_block_ids
    ids = [ @video.id, @check.content_block_id, @exercise.id ]
    ids + ContentRedirect.where(cohort_id: @cohort.id, record_type: "ContentBlock", old_id: ids).pluck(:new_id)
  end

  def ask_for_help
    as_user(@student) do
      post "/api/v1/help_requests", params: { cohort_id: @cohort.id, context_type: "lesson", context_id: @lesson.id, category: "concept", message: "Stuck" }, headers: auth_headers, as: :json
    end
  end

  # Copies, and once the copy holds every lock and has verified progress,
  # waits until the request thread is blocked on it before committing.
  #
  # The copy's backend pid is read inside its transaction, at that stage. Read
  # before the transaction, a transaction-mode pooler (CI's PgBouncer) can
  # answer from another backend than the one the copy then runs on, and the
  # wait below would watch the wrong backend while the request waits on the
  # copy (CI run 43971309871).
  def copy_holding_until_waited_on(request_thread, started)
    CurriculumCopyForCohort.stage_hook = lambda do |stage|
      next unless stage == :verified

      pid = ActiveRecord::Base.connection.select_value("SELECT pg_backend_pid()")
      started << :holding
      wait_for_lock_waiters(pid, workers: [ request_thread ])
    end
    CurriculumCopyForCohort.new(cohort: Cohort.find(@cohort.id), user: User.find(@admin.id), source_curriculum_id: @curriculum.id).copy!
    :committed
  ensure
    CurriculumCopyForCohort.stage_hook = nil
  end

  def complete_block(block_id)
    as_user(@student) { patch "/api/v1/progress", params: { content_block_id: block_id, status: "completed" }, headers: auth_headers, as: :json }
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(user)
    payload = { "sub" => user.clerk_id, "email" => user.email, "first_name" => user.first_name, "last_name" => user.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
