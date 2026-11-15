require "test_helper"

# T-12: moving lessons within and between modules keeps learner data on the
# same rows; duplicating makes new rows and copies no learner data.
class LessonMoveDuplicateTest < ActionDispatch::IntegrationTest
  def setup
    @curriculum = Curriculum.create!(name: "Synthetic Web Lab")
    @cohort = Cohort.create!(curriculum: @curriculum, name: "Cohort 3", start_date: Date.new(2026, 9, 7), status: :active)
    @basics = CurriculumModule.create!(curriculum: @curriculum, name: "JavaScript basics", position: 0, day_offset: 0, schedule_days: "weekdays")
    @dom = CurriculumModule.create!(curriculum: @curriculum, name: "The DOM", position: 1, day_offset: 14, schedule_days: "mwf")
    @first = lesson(@basics, "Variables", day: 0, position: 0)
    @second = lesson(@basics, "Decisions", day: 0, position: 1)
    @third = lesson(@basics, "Loops", day: 0, position: 2)
    @exercise = @second.content_blocks.create!(block_type: :exercise, position: 0, title: "Ticket prices", body: "Write it.", submission_type: :text_submission)
    @checkpoint = @second.content_blocks.create!(block_type: :checkpoint, position: 1, title: "Quick check")
    @check = @checkpoint.create_knowledge_check!(prompt: "What runs?", options: [ "if", "else" ], correct_option: 0, explanation: "if first.")
    @objective = LearningObjective.create!(curriculum: @curriculum, code: "JS.1", title: "Choose a path", success_criteria: "I can branch.")
    ObjectiveAlignment.create!(lesson: @second, learning_objective: @objective, content_block: @exercise, position: 0)

    @admin = User.create!(clerk_id: "clerk_move_admin", email: "move-admin@example.invalid", first_name: "Leon", last_name: "Tester", role: :admin)
    @student = User.create!(clerk_id: "clerk_move_student", email: "move-student@example.invalid", first_name: "Alex", last_name: "Rivera", role: :student)
    @enrollment = Enrollment.create!(user: @student, cohort: @cohort, status: :active)
  end

  # Move ----------------------------------------------------------------------

  test "reorders a lesson within its day without touching other lessons' content" do
    move(@third, module_id: @basics.id, release_day: 0, position: 0)

    assert_response :success
    assert_equal [ @third.id, @first.id, @second.id ], @basics.lessons.reload.map(&:id)
    assert_equal [ 0, 1, 2 ], @basics.lessons.map(&:position)
    assert_equal "Loops", response.parsed_body.dig("lesson", "title")
    assert_equal({ "learners_losing_access" => 0, "learners_with_work_losing_access" => 0, "learners_gaining_access" => 0, "self_paced_learners" => false }, response.parsed_body["impact"])
  end

  test "moves to another day of the module and refuses a day the module doesn't meet" do
    move(@second, module_id: @basics.id, release_day: 2, position: 0)
    assert_response :success
    assert_equal [ 2, 0 ], [ @second.reload.release_day, @second.position ]
    assert_equal [ @first.id, @third.id ], @basics.lessons.where(release_day: 0).map(&:id)

    move(@second, module_id: @basics.id, release_day: 5, position: 0)
    assert_response :unprocessable_entity
    assert_equal "release_day", response.parsed_body["code"]
    assert_equal 2, @second.reload.release_day
  end

  test "moving between modules keeps the lesson id, block ids and every kind of learner data attached" do
    both_modules!
    progress = Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)
    submission = Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "function ticketPrice() {}")
    attempt = KnowledgeCheckAttempt.create!(user: @student, enrollment: @enrollment, knowledge_check: @check, selected_option: 0, correct: true)
    lesson_assignment = LessonAssignment.create!(enrollment: @enrollment, lesson: @second, unlocked: true)

    move(@second, module_id: @dom.id, release_day: 2, position: 0)

    assert_response :success
    @second.reload
    assert_equal [ @dom.id, 2 ], [ @second.module_id, @second.release_day ]
    assert_equal [ @exercise.id, @checkpoint.id ], @second.content_blocks.map(&:id)
    assert_equal @exercise.id, progress.reload.content_block_id
    assert_equal @exercise.id, submission.reload.content_block_id
    assert_equal @check.id, attempt.reload.knowledge_check_id
    assert_equal @second.id, lesson_assignment.reload.lesson_id
    assert_equal [ @exercise.id ], @second.objective_alignments.map(&:content_block_id)
  end

  test "refuses a module change that would hide the lesson from a learner with work in it, and the dry run says so" do
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)

    move(@second, module_id: @dom.id, release_day: 0, position: 0, dry_run: true)
    assert_response :success
    assert_equal 1, response.parsed_body.dig("impact", "learners_with_work_losing_access")
    assert_equal @basics.id, @second.reload.module_id, "a dry run saves nothing"

    move(@second, module_id: @dom.id, release_day: 0, position: 0)
    assert_response :unprocessable_entity
    assert_equal "learner_access", response.parsed_body["code"]
    assert_match "The DOM", response.parsed_body["error"]
    assert_equal @basics.id, @second.reload.module_id

    # Giving the learner the target module first makes the move safe.
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @dom, unlocked: true)
    move(@second, module_id: @dom.id, release_day: 0, position: 0)
    assert_response :success
  end

  test "legacy work saved without an enrollment counts by learner" do
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
    Progress.create!(user: @student, enrollment: nil, content_block: @exercise, status: :completed)

    move(@second, module_id: @dom.id, release_day: 0, position: 0)
    assert_response :unprocessable_entity
    assert_equal "learner_access", response.parsed_body["code"]
  end

  test "the dry run reports learners who would start or stop seeing the lesson" do
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
    other = User.create!(clerk_id: "clerk_move_other", email: "move-other@example.invalid", role: :student)
    ModuleAssignment.create!(enrollment: Enrollment.create!(user: other, cohort: @cohort, status: :active), curriculum_module: @dom, unlocked: true)

    move(@second, module_id: @dom.id, release_day: 0, position: 0, dry_run: true)
    assert_equal({ "learners_losing_access" => 1, "learners_with_work_losing_access" => 0, "learners_gaining_access" => 1, "self_paced_learners" => false },
                 response.parsed_body["impact"])
  end

  test "moves stay inside the curriculum, need the current version and an active lesson" do
    other = CurriculumModule.create!(curriculum: Curriculum.create!(name: "Other"), name: "Elsewhere", position: 0, day_offset: 0, schedule_days: "weekdays")
    move(@second, module_id: other.id, release_day: 0, position: 0)
    assert_response :unprocessable_entity
    assert_equal "module_mismatch", response.parsed_body["code"]

    move(@second, module_id: @basics.id, release_day: 0, position: 0, base_updated_at: 1.day.ago.iso8601(6))
    assert_response :conflict
    assert_equal "stale_editor", response.parsed_body["code"]

    move(@second, module_id: @basics.id, release_day: 0, position: 9)
    assert_response :unprocessable_entity

    @second.archive!
    move(@second, module_id: @basics.id, release_day: 0, position: 0)
    assert_response :unprocessable_entity
    assert_equal "archived", response.parsed_body["code"]
  end

  # Access is decided with the lesson page's rule (LessonReadAccess), before
  # and after, not by whether an assignment row exists.

  test "refuses a move into a module that is assigned but hasn't opened, and the dry run counts it" do
    travel_to Time.zone.local(2026, 11, 18, 10) do
      future = CurriculumModule.create!(curriculum: @curriculum, name: "Capstone", position: 2, day_offset: 100, schedule_days: "weekdays")
      ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
      ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: future, unlocked: false)
      Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :in_progress)
      assert_equal [ true, "open" ], learner_view(@second)

      move(@second, module_id: future.id, release_day: 0, position: 0, dry_run: true)
      assert_response :success
      assert_equal({ "learners_losing_access" => 1, "learners_with_work_losing_access" => 1, "learners_gaining_access" => 0, "self_paced_learners" => false },
                   response.parsed_body["impact"])

      move(@second, module_id: future.id, release_day: 0, position: 0)
      assert_response :unprocessable_entity
      assert_equal "learner_access", response.parsed_body["code"]
      assert_match "Capstone", response.parsed_body["error"]
      assert_match "that day hasn't opened for them yet", response.parsed_body["error"]
      assert_equal @basics.id, @second.reload.module_id
      assert_equal [ true, "open" ], learner_view(@second)
    end
  end

  test "refuses a later day the module's schedule hasn't reached for a learner with work" do
    travel_to Time.zone.local(2026, 11, 18, 10) do
      CohortModuleSchedule.create!(cohort: @cohort, curriculum_module: @basics, start_date: Date.new(2026, 11, 16))
      ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: false)
      Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :in_progress)
      assert_equal [ true, "open" ], learner_view(@second)

      move(@second, module_id: @basics.id, release_day: 4, position: 0, dry_run: true)
      assert_equal 1, response.parsed_body.dig("impact", "learners_with_work_losing_access")
      move(@second, module_id: @basics.id, release_day: 4, position: 0)
      assert_response :unprocessable_entity
      assert_equal "learner_access", response.parsed_body["code"]

      move(@second, module_id: @basics.id, release_day: 2, position: 0)
      assert_response :success, "a day that has already opened is fine"
      assert_equal [ true, "open" ], learner_view(@second)
    end
  end

  test "a paused learner's read cutoff counts: a module assigned after the pause doesn't keep their work open" do
    travel_to Time.zone.local(2026, 11, 18, 10) do
      @second.update_columns(created_at: Time.zone.local(2026, 11, 1))
      source = ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
      source.update_columns(created_at: Time.zone.local(2026, 11, 1), updated_at: Time.zone.local(2026, 11, 1), availability_changed_at: Time.zone.local(2026, 11, 1))
      ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @dom, unlocked: true)
      Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)
      @enrollment.update_columns(status: Enrollment.statuses.fetch("paused"), paused_at: Time.zone.local(2026, 11, 10))
      assert LessonReadAccess.readable?(@enrollment.reload, @second, source.reload, nil)

      move(@second, module_id: @dom.id, release_day: 0, position: 0)
      assert_response :unprocessable_entity
      assert_equal "learner_access", response.parsed_body["code"]
      assert_equal @basics.id, @second.reload.module_id
    end
  end

  test "a lesson assignment keeps the lesson open wherever it moves" do
    travel_to Time.zone.local(2026, 11, 18, 10) do
      ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
      LessonAssignment.create!(enrollment: @enrollment, lesson: @second, unlocked: false, unlock_date_override: Date.new(2026, 11, 2))
      Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)

      move(@second, module_id: @dom.id, release_day: 0, position: 0, dry_run: true)
      assert_equal 0, response.parsed_body.dig("impact", "learners_losing_access")
      move(@second, module_id: @dom.id, release_day: 0, position: 0)
      assert_response :success
      readable, status = learner_view(@second)
      assert readable
      refute_equal "upcoming", status
    end
  end

  # Duplicate -----------------------------------------------------------------

  test "duplicating makes an archived copy with new blocks, its own check and alignments, and no learner data" do
    Progress.create!(user: @student, enrollment: @enrollment, content_block: @exercise, status: :completed)
    Submission.create!(user: @student, enrollment: @enrollment, content_block: @exercise, text: "answer")
    KnowledgeCheckAttempt.create!(user: @student, enrollment: @enrollment, knowledge_check: @check, selected_option: 0, correct: true)
    original_updated_at = @second.updated_at

    as_user(@admin) { post "/api/v1/lessons/#{@second.id}/duplicate", headers: auth_headers, as: :json }

    assert_response :created
    copy = Lesson.find(response.parsed_body.dig("lesson", "id"))
    assert_equal [ "Decisions (copy)", @basics.id, 0 ], [ copy.title, copy.module_id, copy.release_day ]
    assert copy.archived?, "learners don't see the copy until it's restored"
    assert_equal %w[exercise checkpoint], copy.content_blocks.map(&:block_type)
    assert_empty copy.content_blocks.map(&:id) & @second.content_blocks.map(&:id)
    copied_check = copy.content_blocks.last.knowledge_check
    refute_equal @check.id, copied_check.id
    assert_equal "What runs?", copied_check.prompt
    assert_equal [ copy.content_blocks.first.id ], copy.objective_alignments.map(&:content_block_id)

    copy_blocks = copy.content_blocks.map(&:id)
    assert_equal 0, Progress.where(content_block_id: copy_blocks).count
    assert_equal 0, Submission.where(content_block_id: copy_blocks).count
    assert_equal 0, KnowledgeCheckAttempt.where(knowledge_check_id: copied_check.id).count
    assert_equal 1, @exercise.progresses.count, "the original keeps its learner data"
    assert_equal original_updated_at, @second.reload.updated_at, "duplicating doesn't invalidate open editors on the original"

    # Learners see the same lessons as before.
    assert_equal [ @first.id, @second.id, @third.id ], @basics.lessons.reload.map(&:id)
  end

  test "a duplicated hosted video shares the stored object" do
    video = @first.content_blocks.create!(block_type: :video, position: 0, title: "Walkthrough", s3_video_key: "content_videos/11111111-1111-4111-8111-111111111111/walkthrough.mp4",
                                          s3_video_content_type: "video/mp4", s3_video_size: 20, s3_video_duration_seconds: 300)
    as_user(@admin) { post "/api/v1/lessons/#{@first.id}/duplicate", headers: auth_headers, as: :json }

    assert_response :created
    copy = Lesson.find(response.parsed_body.dig("lesson", "id")).content_blocks.sole
    refute_equal video.id, copy.id
    assert_equal [ video.s3_video_key, 300 ], [ copy.s3_video_key, copy.s3_video_duration_seconds ]
  end

  private

  # What the learner sees: can they open the lesson, and its status in their
  # progress.
  def learner_view(lesson)
    progress = LearnerProgress.new(@enrollment.reload)
    view = progress.lessons.find { |candidate| candidate.id == lesson.id }
    [ LessonReadAccess.check(@student, lesson.reload).allowed?, view && progress.lesson_progress(view).status ]
  end

  def both_modules!
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @basics, unlocked: true)
    ModuleAssignment.create!(enrollment: @enrollment, curriculum_module: @dom, unlocked: true)
  end

  def lesson(mod, title, day:, position:)
    Lesson.create!(curriculum_module: mod, title: title, release_day: day, position: position)
  end

  def move(lesson, module_id:, release_day:, position:, dry_run: nil, base_updated_at: lesson.reload.updated_at.iso8601(6))
    body = { module_id: module_id, release_day: release_day, position: position, base_updated_at: base_updated_at }
    body[:dry_run] = dry_run unless dry_run.nil?
    as_user(@admin) { post "/api/v1/lessons/#{lesson.id}/move", params: body, headers: auth_headers, as: :json }
  end

  def auth_headers = { "Authorization" => "Bearer test_token" }

  def as_user(person)
    payload = { "sub" => person.clerk_id, "email" => person.email, "first_name" => person.first_name, "last_name" => person.last_name }
    original = ClerkAuth.method(:verify)
    ClerkAuth.define_singleton_method(:verify) { |_token| payload }
    yield
  ensure
    ClerkAuth.define_singleton_method(:verify, original)
  end
end
