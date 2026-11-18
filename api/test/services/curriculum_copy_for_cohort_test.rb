require "test_helper"
require_relative "../support/curriculum_copy_fixture"

# "Make a copy for this cohort" (CurriculumCopyForCohort): the copy, the
# remap of every table that references content, what stays, and rollback.
class CurriculumCopyForCohortTest < ActiveSupport::TestCase
  include CurriculumCopyFixture

  setup do
    @f = build_shared_curriculum
    CurriculumCopyForCohort.stage_hook = nil
  end

  teardown { CurriculumCopyForCohort.stage_hook = nil }

  { ahead: 1.day, behind: -1.day }.each do |direction, offset|
    test "copy write guard uses the request clock when Ruby is #{direction} of PostgreSQL" do
      database_now = Time.zone.parse(ActiveRecord::Base.connection.select_value("SELECT clock_timestamp()").to_s)
      travel_to(database_now + offset) do
        request_started_at = Time.current - 1.second
        copy!(@f.instructor)
        enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)

        [ request_started_at, Time.current ].each do |started_at|
          error = assert_raises(Enrollment::StaleLearningWrite) do
            enrollment.with_learning_write_guard(request_started_at: started_at) { flunk "old content must not be written" }
          end
          assert_equal "content_moved", error.code
        end
        assert_equal :saved, enrollment.with_learning_write_guard(request_started_at: Time.current + 1.second) { :saved }
        assert_equal Time.current, enrollment.reload.content_moved_at
      end
    end
  end

  test "copy remaps learner extension targets and revision history" do
    enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)
    content = AssignedLearningContent.new(enrollment)
    lesson = content.modules.flat_map { |mod| content.lessons_for(mod) }.first
    @f.cohort.cohort_module_submission_windows.find_or_initialize_by(module_id: lesson.module_id,
      week_number: SubmissionWindowStatus.week_number_for_release_day(lesson.release_day)).update!(submissions_close_at: 1.day.from_now)
    extension = enrollment.learner_extensions.new(scope: "lesson", lesson: lesson, reason: "Travel", submissions_close_at: 1.week.from_now)
    extension.record_change!(actor: @f.instructor)
    result = copy!(@f.instructor)
    expected = result.lesson_ids.fetch(lesson.id.to_s)
    assert_equal expected, extension.reload.lesson_id
    assert_equal expected, extension.revisions.first.fetch("lesson_id")
    assert_equal "Travel", extension.reason
    assert_equal 1, result.counts.fetch("learner_extensions")
  end

  test "copy counts and remaps a module-week grant and its history" do
    enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)
    mod = AssignedLearningContent.new(enrollment).modules.first
    @f.cohort.cohort_module_submission_windows.find_or_initialize_by(module_id: mod.id, week_number: 1).update!(submissions_close_at: 1.day.from_now)
    extension = enrollment.learner_extensions.new(scope: "module", module_id: mod.id, week_number: 1, reason: "Travel", submissions_close_at: 1.week.from_now)
    extension.record_change!(actor: @f.instructor)
    planned = CurriculumCopyForCohort.new(cohort: @f.cohort, user: @f.instructor, source_curriculum_id: @f.cohort.curriculum_id).preview
    result = copy!(@f.instructor)
    expected = @f.cohort.reload.curriculum.modules.order(:position, :id).first.id
    assert_equal expected, extension.reload.module_id
    assert_equal expected, extension.revisions.first.fetch("module_id")
    assert_equal 1, result.counts.fetch("learner_extensions")
    assert_equal 1, planned.fetch(:counts).fetch("learner_extensions")
  end

  test "copy preserves and remaps the paused library" do
    enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)
    enrollment.update!(status: :paused)
    before = enrollment.reload.paused_lesson_ids
    assert before.any?
    result = copy!(@f.instructor)
    assert_equal before.map { |id| result.lesson_ids.fetch(id.to_s, id) }, enrollment.reload.paused_lesson_ids
    assert enrollment.paused?
  end

  test "a pause request crossing a copy is refused and a fresh pause captures copied ids" do
    enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)
    stale = Enrollment.find(enrollment.id)
    started_at = Time.current
    result = copy!(@f.instructor)
    error = assert_raises(Enrollment::StaleLearningWrite) do
      stale.with_learning_write_guard(request_started_at: started_at) do
        stale.association(:cohort).reset
        stale.update!(status: :paused)
      end
    end
    assert_equal "content_moved", error.code
    assert enrollment.reload.active?
    stale.with_learning_write_guard(request_started_at: enrollment.content_moved_at + 1.second) do
      stale.association(:cohort).reset
      stale.update!(status: :paused)
    end
    assert stale.paused_lesson_ids.any?
    assert_empty stale.paused_lesson_ids & result.lesson_ids.keys.map(&:to_i)
    assert (stale.paused_lesson_ids - result.lesson_ids.values).empty?
  end

  test "HTTP pause crossing a copy returns content_moved and retry captures copied lessons" do
    enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)
    original_verify = ClerkAuth.method(:verify)
    test_case = self
    copied = false
    result = nil
    payload = { "sub" => @f.admin.clerk_id, "email" => @f.admin.email }
    ClerkAuth.define_singleton_method(:verify) do |_token|
      unless copied
        copied = true
        result = test_case.send(:copy!, test_case.instance_variable_get(:@f).instructor)
      end
      payload
    end
    client = ActionDispatch::Integration::Session.new(Rails.application)
    client.patch "/api/v1/enrollments/#{enrollment.id}", params: { status: "paused" }, headers: { "Authorization" => "Bearer test" }, as: :json
    assert_equal 409, client.response.status
    assert_equal "content_moved", client.response.parsed_body["code"]
    assert enrollment.reload.active?
    client.patch "/api/v1/enrollments/#{enrollment.id}", params: { status: "paused" }, headers: { "Authorization" => "Bearer test" }, as: :json
    assert_equal 200, client.response.status
    assert enrollment.reload.paused_lesson_ids.any?
    assert_empty enrollment.paused_lesson_ids & result.lesson_ids.keys.map(&:to_i)
  ensure
    ClerkAuth.define_singleton_method(:verify, original_verify) if original_verify
  end

  test "practice reviews stay with original blocks and copies require a fresh review" do
    original = @f.blocks.fetch(:read)
    review = SubmissionAuditReview.create!(content_block: original, reviewed_by: @f.admin, content_digest: SubmissionAudit.digest(original))
    result = copy!(@f.instructor)
    assert_equal original.id, review.reload.content_block_id
    copy_block_ids = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: result.copy.copy_curriculum_id }).pluck(:id)
    assert_empty SubmissionAuditReview.where(content_block_id: copy_block_ids)
  end

  test "copies the curriculum, moves the cohort and every row of its learner data, and leaves the other cohort alone" do
    other_before = other_cohort_rows
    shared_before = shared_tree
    learner_ids = [ @f.learner.id, @f.classmate.id ]

    result = copy!(@f.instructor)

    copy = result.copy.copy_curriculum
    cohort = @f.cohort.reload
    refute result.already_copied
    assert_equal copy.id, cohort.curriculum_id
    # Stored without the cohort's name; CurriculumName adds it for viewers who can see the cohort.
    assert_equal "#{@f.curriculum.name} (copy)", copy.name
    assert_equal "#{@f.curriculum.name} (#{cohort.name})", CurriculumName.new(@f.admin).for(copy)
    assert_nil copy.course_package_key, "the package key stays with the shared curriculum"
    assert_equal [ "rev-7", @f.curriculum.course_package_digest, "active" ], [ copy.course_package_revision, copy.course_package_digest, copy.status ]

    # The copied tree, with archived lessons and package keys carried over.
    modules = copy.modules.to_a
    assert_equal [ "Week one", "Week two" ], modules.map(&:name)
    assert_equal "week-one", modules.first.course_package_key
    lessons = Lesson.where(module_id: modules.map(&:id)).order(:module_id, :position)
    assert_equal [ "Intro", "Project", "Retired", "Later" ], lessons.map(&:title)
    assert lessons.find { |lesson| lesson.title == "Retired" }.archived?
    new_lesson = ->(key) { result.lesson_ids.fetch(@f.lessons.fetch(key).id.to_s) }
    new_block = ->(key) { ContentRedirect.find_by!(cohort_id: cohort.id, record_type: "ContentBlock", old_id: @f.blocks.fetch(key).id).new_id }
    copied_check = KnowledgeCheck.find_by!(content_block_id: new_block.call(:check))
    assert_equal [ [ "Yes", "No" ], 0 ], [ copied_check.options, copied_check.correct_option ]
    copied_objective = copy.learning_objectives.sole
    assert_equal copied_objective.id, copied_check.learning_objective_id
    copied_rubric = copy.rubrics.sole
    copied_criterion = copied_rubric.rubric_criteria.sole
    assert_equal copied_objective.id, copied_criterion.learning_objective_id
    assert_equal copied_rubric.id, ContentBlock.find(new_block.call(:exercise)).rubric_id
    assert_equal [ [ new_lesson.call(:project), new_block.call(:exercise) ], [ new_lesson.call(:intro), nil ] ].sort_by(&:first),
      ObjectiveAlignment.where(learning_objective_id: copied_objective.id).pluck(:lesson_id, :content_block_id).sort_by(&:first)
    assert_equal "https://www.youtube.com/watch?v=dQw4w9WgXcQ", ContentBlock.find(new_block.call(:video)).video_url
    assert_equal "Next: [Project](/lessons/#{new_lesson.call(:project)}#block-#{new_block.call(:exercise)}) and [week two](/modules/#{modules.second.id}).",
      ContentBlock.find(new_block.call(:read)).body, "links inside the copy point at the copy"
    resource = copy.curriculum_resources.sole
    assert_equal [ @f.resource.s3_key, true, "Starter ZIP" ], [ resource.s3_key, resource.ready?, resource.title ], "the ZIP is shared by reference"
    refute_equal @f.resource.upload_key, resource.upload_key

    # The cohort's rows, matrix: table => rows now on the copy.
    module_ids = modules.map(&:id)
    enrollment_ids = cohort.enrollments.ids
    assert_equal module_ids.map(&:to_s).sort, cohort.content_defaults.keys.sort
    assert_equal [ modules.first.id ], CohortModuleSchedule.where(cohort_id: cohort.id).pluck(:module_id)
    assert_equal [ modules.first.id ], CohortModuleSubmissionWindow.where(cohort_id: cohort.id).pluck(:module_id)
    assert_equal (module_ids * 2).sort, ModuleAssignment.where(enrollment_id: enrollment_ids).pluck(:module_id).sort
    assert_equal [ new_lesson.call(:later) ] * 2, LessonAssignment.where(enrollment_id: enrollment_ids).pluck(:lesson_id)
    assert_equal ([ :check, :read, :video ].map { |key| new_block.call(key) } * 2).sort,
      Progress.where(enrollment_id: enrollment_ids).pluck(:content_block_id).sort
    assert_equal [ new_block.call(:later_read) ], Progress.where(enrollment_id: nil, user_id: @f.classmate.id).pluck(:content_block_id), "an older row of a learner only in this cohort moves too"
    video_progress = Progress.find_by!(enrollment_id: cohort.enrollments.find_by!(user: @f.learner).id, content_block_id: new_block.call(:video))
    assert_equal [ 40, 40, 100, 0.4 ], [ video_progress.video_last_position, video_progress.video_total_watched, video_progress.video_duration, video_progress.watch_credit_fraction ]
    submissions = Submission.where(enrollment_id: enrollment_ids)
    assert_equal [ new_block.call(:exercise) ] * 2, submissions.pluck(:content_block_id)
    assert_equal (@f.rows[:submissions].map(&:id) & submissions.ids).sort, submissions.ids.sort, "submission ids don't change"
    assert_equal [ copied_criterion.id ] * 2, SubmissionCriterionResult.where(submission_id: submissions.ids).pluck(:rubric_criterion_id)
    assert_equal submissions.ids.sort, GithubCheckRun.where(submission_id: submissions.ids).pluck(:submission_id).sort
    assert_equal [ copied_check.id ] * 2, KnowledgeCheckAttempt.where(enrollment_id: enrollment_ids).pluck(:knowledge_check_id)
    plan = @f.rows[:learning_plans].first.reload
    assert_equal [ new_lesson.call(:project), new_lesson.call(:intro) ], plan.milestones.first["lesson_ids"]
    assert_equal new_lesson.call(:later), plan.lesson_overrides.first["lesson_id"]
    assert_equal plan.milestones, @f.rows[:learning_plan_revisions].first.reload.snapshot["milestones"]
    help = HelpRequest.where(cohort_id: cohort.id).order(:id)
    assert_equal [ new_lesson.call(:intro), new_block.call(:exercise) ] * 2, help.pluck(:context_id)
    assert_includes help.pluck(:context_path), "/lessons/#{new_lesson.call(:project)}?cohort_id=#{cohort.id}#block-#{new_block.call(:exercise)}"
    conversations = DirectConversation.where(cohort_id: cohort.id).ids
    assert_equal [ new_lesson.call(:intro) ] * 2, Message.where(direct_conversation_id: conversations, source_type: "Lesson").pluck(:source_id)
    assert_equal [ "/lessons/#{new_lesson.call(:project)}?cohort_id=#{cohort.id}#block-#{new_block.call(:exercise)}" ] * 2,
      Notification.where(user_id: learner_ids).pluck(:path)
    assert_equal [ new_block.call(:read) ] * 2, ActivityEvent.where(cohort_id: cohort.id, record_type: "ContentBlock").pluck(:record_id)
    assert Enrollment.where(id: enrollment_ids).all? { |enrollment| enrollment.content_moved_at.present? }

    # Redirects for every copied module, lesson, block and check.
    assert_equal({ "CurriculumModule" => 2, "Lesson" => 4, "ContentBlock" => 6, "KnowledgeCheck" => 1 },
      ContentRedirect.where(cohort_id: cohort.id).group(:record_type).count)
    assert_equal result.counts, result.copy.counts
    assert_equal 2, result.counts["submissions"]

    # Other cohort and the shared curriculum: not a single row changed.
    assert_equal other_before, other_cohort_rows
    assert_equal shared_before, shared_tree
    assert_nil @f.other_cohort.enrollments.first.content_moved_at
    assert_equal @f.curriculum.id, @f.other_cohort.reload.curriculum_id

    # Grants now cover the cohort's own copy; the copy is audited.
    access = LessonEditAccess.for(@f.instructor, copy)
    assert_equal "granted", access.reason
    assert_equal cohort.id, access.copy_of.dig(:cohort, :id)
    assert_equal [ @f.other_cohort.id ], Cohort.where(curriculum_id: @f.curriculum.id).ids
    event = ActivityEvent.find_by!(event_type: "curriculum_copied", cohort_id: cohort.id)
    assert_equal [ @f.instructor.id, @f.instructor.id ], [ event.actor_id, event.subject_user_id ]
    assert_equal [ @f.curriculum.id, copy.id, @f.instructor.id ], [ result.copy.source_curriculum_id, result.copy.copy_curriculum_id, result.copy.created_by_id ]
  end

  test "every learner's status, counts and next step are the same before and after" do
    before = learner_views
    assert before.values.any? { |view| view[:next].present? }, "the fixture has a next step"
    assert before.values.any? { |view| view[:lessons].any? { |row| row[1] == "redo" } }, "the fixture has a redo"

    copy!(@f.admin)

    assert_equal before, learner_views
  end

  test "the dry run counts what the copy moves and changes nothing" do
    before = everything
    preview = service(@f.instructor).preview

    assert_equal everything, before
    assert preview[:can_copy]
    assert_equal [ [], 1 ], preview.values_at(:shared_with, :shared_with_others_count), "The instructor doesn't teach the other cohort (L-3.2)"
    assert_equal [ @f.other_cohort.id ], service(@f.admin).preview[:shared_with].map { |cohort| cohort[:id] }
    result = copy!(@f.instructor)
    assert_equal result.counts, preview[:counts]
  end

  test "a retry after success returns the same copy and changes nothing" do
    first = copy!(@f.instructor)
    before = everything

    second = copy!(@f.instructor)

    assert second.already_copied
    assert_equal first.copy.id, second.copy.id
    assert_equal first.lesson_ids, second.lesson_ids
    assert_equal before, everything
    assert service(@f.instructor).preview[:already_copied]
  end

  CurriculumCopyForCohort::STAGES.each do |stage|
    test "a failure after the #{stage} stage rolls everything back, and a retry then copies" do
      before = everything
      CurriculumCopyForCohort.stage_hook = ->(name) { raise "injected failure at #{name}" if name == stage }

      error = assert_raises(RuntimeError) { copy!(@f.instructor) }
      assert_equal "injected failure at #{stage}", error.message
      assert_equal before, everything

      CurriculumCopyForCohort.stage_hook = nil
      result = copy!(@f.instructor)
      assert_equal result.copy.copy_curriculum_id, @f.cohort.reload.curriculum_id
    end
  end

  test "a learner whose progress would change stops the copy" do
    before = everything
    # Simulate a remap bug: drop the learner's completed check after the move.
    CurriculumCopyForCohort.stage_hook = lambda do |name|
      next unless name == :audit

      Progress.where(enrollment_id: @f.cohort.enrollments.find_by!(user: @f.learner).id).where.not(status: Progress.statuses.fetch("in_progress")).delete_all
    end

    error = assert_raises(CurriculumCopyForCohort::VerificationFailed) { copy!(@f.instructor) }
    assert_match "Learner progress would change for 1 learner", error.message
    assert_equal before, everything
  end

  test "per-module GitHub settings follow the copied modules, so submission type and repository resolve the same, and other settings stay" do
    week1, week2 = @f.modules
    legacy = legacy_github_exercise
    settings = {
      "module_github_config" => { week1.id.to_s => { "requires_github" => true, "repository_name" => "module-specific-repo" }, "999999" => { "requires_github" => true } },
      "class_resources" => [ { "title" => "Docs", "url" => "https://example.com/docs" } ],
      "announcements" => [ { "title" => "Welcome" } ],
      "features" => { "github_sync" => true }
    }
    @f.cohort.update_columns(settings: settings, repository_name: "cohort-repo")
    other_settings = @f.other_cohort.reload.settings
    enrollment = @f.cohort.enrollments.find_by!(user: @f.learner)
    before = [ legacy.submission_type_for(enrollment), GithubIssueService.send(:resolve_repo, @f.cohort, week1), GithubIssueService.send(:resolve_repo, @f.cohort, week2) ]
    assert_equal [ "prework_github_sync", "module-specific-repo", "cohort-repo" ], before, "the fixture uses the module's settings"

    result = copy!(@f.instructor)

    cohort = Cohort.find(@f.cohort.id)
    new_module = ->(mod) { ContentRedirect.find_by!(cohort_id: cohort.id, record_type: "CurriculumModule", old_id: mod.id).new_id }
    new_legacy = ContentBlock.find(ContentRedirect.find_by!(cohort_id: cohort.id, record_type: "ContentBlock", old_id: legacy.id).new_id)
    enrollment = Enrollment.find(enrollment.id)
    after = [ new_legacy.submission_type_for(enrollment), GithubIssueService.send(:resolve_repo, cohort, CurriculumModule.find(new_module.call(week1))),
      GithubIssueService.send(:resolve_repo, cohort, CurriculumModule.find(new_module.call(week2))) ]
    assert_equal before, after
    assert_equal settings.merge("module_github_config" => { new_module.call(week1).to_s => settings["module_github_config"][week1.id.to_s], "999999" => { "requires_github" => true } }),
      cohort.settings, "only module keys change; other settings, and keys of no copied module, are kept"
    assert_equal other_settings, @f.other_cohort.reload.settings, "the other cohort's settings don't change"
    assert_equal 1, result.counts["cohorts"]
  end

  # Remap omissions LearnerProgress can't see still roll the copy back.
  {
    "per-module GitHub settings left on the old module ids" => lambda do |test|
      test.instance_eval do
        cohort = Cohort.find(@f.cohort.id)
        old = cohort.settings["module_github_config"].transform_keys { |key| ContentRedirect.find_by(cohort_id: cohort.id, record_type: "CurriculumModule", new_id: key.to_i)&.old_id&.to_s || key }
        cohort.update_columns(settings: cohort.settings.merge("module_github_config" => old))
      end
    end,
    "video watch credit left on the shared block" => lambda do |test|
      test.instance_eval do
        video = @f.blocks[:video]
        new_id = ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "ContentBlock", old_id: video.id).new_id
        Progress.where(enrollment_id: @f.cohort.enrollments.find_by!(user: @f.learner).id, content_block_id: new_id).update_all(content_block_id: video.id)
      end
    end,
    "checkpoint answers left on the shared check" => lambda do |test|
      test.instance_eval do
        new_id = ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "KnowledgeCheck", old_id: @f.check.id).new_id
        KnowledgeCheckAttempt.where(enrollment_id: @f.cohort.enrollments.find_by!(user: @f.learner).id, knowledge_check_id: new_id).update_all(knowledge_check_id: @f.check.id)
      end
    end
  }.each do |omission, undo|
    test "a copy with #{omission} rolls back" do
      legacy_github_exercise
      @f.cohort.update_columns(settings: { "module_github_config" => { @f.modules.first.id.to_s => { "requires_github" => true, "repository_name" => "module-specific-repo" } } })
      before = everything
      CurriculumCopyForCohort.stage_hook = ->(name) { undo.call(self) if name == :audit }

      error = assert_raises(CurriculumCopyForCohort::VerificationFailed) { copy!(@f.instructor) }
      assert_match(/Learner progress would change for \d learners?/, error.message)
      assert_equal before, everything
    end
  end

  # The review's race left a deadline on the shared module while the copied
  # module had none; LearnerProgress didn't notice. The cohort's windows are
  # compared on their own, by module, count and close time.
  {
    "a submission window left on the shared module" => lambda do |test|
      test.instance_eval do
        new_id = ContentRedirect.find_by!(cohort_id: @f.cohort.id, record_type: "CurriculumModule", old_id: @f.modules.first.id).new_id
        CohortModuleSubmissionWindow.where(cohort_id: @f.cohort.id, module_id: new_id).update_all(module_id: @f.modules.first.id)
      end
    end,
    "a submission window missing from the copy" => lambda do |test|
      test.instance_eval { CohortModuleSubmissionWindow.where(cohort_id: @f.cohort.id).delete_all }
    end,
    "a submission window closing at another time" => lambda do |test|
      test.instance_eval { CohortModuleSubmissionWindow.where(cohort_id: @f.cohort.id).update_all(submissions_close_at: 10.days.from_now) }
    end
  }.each do |omission, undo|
    test "a copy with #{omission} rolls back" do
      before = everything
      CurriculumCopyForCohort.stage_hook = ->(name) { undo.call(self) if name == :audit }

      error = assert_raises(CurriculumCopyForCohort::VerificationFailed) { copy!(@f.instructor) }
      assert_match "#{@f.cohort.name}'s submission deadlines would change", error.message
      assert_equal before, everything
    end
  end

  test "remaps run one statement per table however many rows move" do
    statements = Hash.new(0)
    subscriber = ActiveSupport::Notifications.subscribe("sql.active_record") do |*, payload|
      statements[Regexp.last_match(1)] += 1 if payload[:sql] =~ /\AUPDATE "(\w+)"/
    end
    copy!(@f.instructor)
    ActiveSupport::Notifications.unsubscribe(subscriber)

    %w[progresses submissions knowledge_check_attempts module_assignments activity_events].each do |table|
      assert_equal 1, statements[table], "#{table}: #{statements.inspect}"
    end
  end

  test "a hosted video replaced while the copy waits for its locks restarts the copy, and gives up if it keeps changing" do
    key = "content_videos/block_#{@f.blocks[:video].id}/20261116000000_intro.mp4"
    replacement = "content_videos/block_#{@f.blocks[:video].id}/20261116000001_intro.mp4"
    @f.blocks[:video].update_columns(s3_video_key: key, video_url: nil)
    verified = []
    swaps = 1
    original = S3ObjectCleanup.method(:verify_attachment)
    S3ObjectCleanup.define_singleton_method(:verify_attachment) do |candidate|
      verified << candidate
      # After the storage check, an author swaps the video before the copy
      # locks the block. The attempt rolls back (taking the swap with it in
      # this single-connection test) and starts over from the checks.
      ContentBlock.where(s3_video_key: candidate).update_all(s3_video_key: replacement) if verified.size <= swaps
      nil
    end

    result = copy!(@f.instructor)
    assert_equal [ key, key ], verified, "the second attempt checked storage again"
    copied = ContentBlock.find(ContentRedirect.find_by!(record_type: "ContentBlock", old_id: @f.blocks[:video].id).new_id)
    assert_equal key, copied.s3_video_key, "both blocks reference the same stored video"
    assert result.copy

    # A video that changes on every attempt: three tries, then a clear refusal.
    other = build_shared_curriculum
    other.blocks[:video].update_columns(s3_video_key: key.sub("block_", "block_9"), video_url: nil)
    verified.clear
    swaps = 99
    before = everything
    error = assert_raises(CurriculumCopyForCohort::Blocked) do
      CurriculumCopyForCohort.new(cohort: other.cohort, user: other.admin, source_curriculum_id: other.curriculum.id).copy!
    end
    assert_equal [ "media_changed", 3 ], [ error.code, verified.size ]
    assert_equal before, everything
  ensure
    S3ObjectCleanup.define_singleton_method(:verify_attachment, original)
  end

  test "older rows that could belong to either cohort block the copy" do
    Enrollment.create!(user: @f.classmate, cohort: @f.other_cohort, status: :active)

    preview = service(@f.admin).preview
    refute preview[:can_copy]
    assert_equal [ "unassigned_learner_work" ], preview[:blockers].map { |blocker| blocker[:code] }
    error = assert_raises(CurriculumCopyForCohort::Blocked) { copy!(@f.admin) }
    assert_equal "unassigned_learner_work", error.code
    assert_equal @f.curriculum.id, @f.cohort.reload.curriculum_id
  end

  test "who can copy: admins and granted instructors, not other staff, and never when no other cohort shares it" do
    assert_equal "not_allowed", assert_raises(CurriculumCopyForCohort::Blocked) { copy!(@f.ungranted) }.code
    assert_equal "not_allowed", assert_raises(CurriculumCopyForCohort::Blocked) { copy!(@f.learner) }.code

    # Cohort 4 has learners, so only a direct write can move it (Cohort refuses).
    @f.other_cohort.update_columns(curriculum_id: Curriculum.create!(name: "Elsewhere #{SecureRandom.hex(3)}").id)
    assert_equal "copy_not_needed", assert_raises(CurriculumCopyForCohort::Blocked) { copy!(@f.instructor) }.code
    assert_equal "copy_not_needed", assert_raises(CurriculumCopyForCohort::Blocked) { copy!(@f.admin) }.code
    assert_equal "source_changed", assert_raises(CurriculumCopyForCohort::Blocked) {
      CurriculumCopyForCohort.new(cohort: @f.cohort, user: @f.admin, source_curriculum_id: @f.other_cohort.curriculum_id).copy!
    }.code
  end

  test "a copy of a copy redirects through both" do
    first = copy!(@f.admin)
    Cohort.create!(curriculum: first.copy.copy_curriculum, name: "Joined #{SecureRandom.hex(3)}", start_date: Date.current, status: :upcoming)
    second = CurriculumCopyForCohort.new(cohort: @f.cohort.reload, user: @f.admin, source_curriculum_id: first.copy.copy_curriculum_id).copy!

    old_intro = @f.lessons[:intro].id
    final = second.lesson_ids.fetch(first.lesson_ids.fetch(old_intro.to_s).to_s)
    assert_equal final, MovedContent.id_for(@f.learner, "Lesson", old_intro)
    assert_equal old_intro, MovedContent.id_for(@f.other_learner, "Lesson", old_intro), "the other cohort still reads the shared lesson"
    assert_equal old_intro, MovedContent.id_for(@f.admin, "Lesson", old_intro), "staff without a cohort read the id they ask for"
    assert_equal final, MovedContent.id_for(@f.admin, "Lesson", old_intro, cohort_id: @f.cohort.id)
  end

  # Cohort (#275) refuses a curriculum change on an enrolled cohort and resets
  # content_defaults on any curriculum change. The copy is the sanctioned
  # move: it goes through, and keeps the cohort's own module selection.
  test "an enrolled cohort moves to its copy with its module selection remapped, not reset" do
    week1, week2 = @f.modules
    @f.cohort.update!(content_defaults: {
      week1.id.to_s => { "assigned" => true, "unlocked" => true, "unlock_date_override" => nil },
      week2.id.to_s => { "assigned" => false, "unlocked" => false, "unlock_date_override" => "2026-12-07" }
    })
    assert @f.cohort.enrollments.exists?

    result = copy!(@f.instructor)

    copied_week1, copied_week2 = result.copy.copy_curriculum.modules.to_a
    cohort = @f.cohort.reload
    assert_equal result.copy.copy_curriculum_id, cohort.curriculum_id
    assert_equal({
      copied_week1.id.to_s => { "assigned" => true, "unlocked" => true, "unlock_date_override" => nil },
      copied_week2.id.to_s => { "assigned" => false, "unlocked" => false, "unlock_date_override" => "2026-12-07" }
    }, cohort.content_defaults)
  end

  test "outside the copy, an enrolled cohort's curriculum still can't change, before or after a copy" do
    elsewhere = Curriculum.create!(name: "Elsewhere #{SecureRandom.hex(3)}", status: :active)
    cohort = Cohort.find(@f.cohort.id)

    refute cohort.update(curriculum_id: elsewhere.id)
    assert_includes cohort.errors[:curriculum], "cannot change while students are enrolled"
    # The copy's flag only covers leaving the curriculum it names.
    cohort = Cohort.find(@f.cohort.id)
    cohort.moving_to_copy_of = elsewhere.id
    refute cohort.update(curriculum_id: elsewhere.id)
    assert_equal @f.curriculum.id, cohort.reload.curriculum_id

    copy = copy!(@f.instructor).copy.copy_curriculum
    cohort = Cohort.find(@f.cohort.id)
    refute cohort.update(curriculum_id: @f.curriculum.id), "moving back to the shared curriculum is refused too"
    assert_includes cohort.errors[:curriculum], "cannot change while students are enrolled"
    assert_equal copy.id, cohort.reload.curriculum_id
  end

  test "copy remaps module repository bindings only for its own enrollments and retains provenance" do
    mod = @f.curriculum.modules.first
    defaults = []
    bindings = [ @f.cohort, @f.other_cohort ].map.with_index do |cohort, index|
      installation = cohort.github_app_installations.create!(app_id: 12345, installation_id: 800 + index, account_id: 900 + index,
        account_login: "synthetic-learner", account_type: "User", repository_selection: "selected", connected_at: Time.current, checked_at: Time.current)
      enrollment = cohort.enrollments.first
      defaults << enrollment.github_repository_bindings.create!(github_app_installation: installation, full_name: "synthetic-learner/default")
      enrollment.github_repository_bindings.create!(github_app_installation: installation, curriculum_module: mod, full_name: "synthetic-learner/module",
        repository_id: 98765, github_username: "synthetic-learner", verification_state: "verified", verified_at: Time.current)
    end
    prior_verified_at = bindings.first.verified_at
    copy!(@f.instructor)
    copied_module = @f.cohort.reload.curriculum.modules.find_by!(name: mod.name)
    assert_equal copied_module.id, bindings.first.reload.curriculum_module_id
    assert_equal mod.id, bindings.last.reload.curriculum_module_id
    assert_equal 98765, bindings.first.repository_id
    assert_equal "verified", bindings.first.verification_state
    assert_equal prior_verified_at, bindings.first.verified_at
    assert defaults.all? { |row| row.reload.curriculum_module_id.nil? }
  end

  test "the table list covers every foreign key into curriculum content" do
    content_tables = %w[curricula modules lessons content_blocks knowledge_checks learning_objectives rubrics rubric_criteria objective_alignments curriculum_resources]
    connection = ActiveRecord::Base.connection
    referencing = connection.tables.select do |table|
      connection.foreign_keys(table).any? { |key| content_tables.include?(key.to_table) }
    end
    missing = (referencing + content_tables).uniq - CurriculumCopyForCohort::TABLES.keys
    assert_empty missing, "Decide whether a cohort copy remaps, keeps or blocks on these tables"
  end

  private

  # An exercise from before submission types: it is synced from GitHub only
  # when its module requires GitHub for the cohort.
  def legacy_github_exercise
    block = @f.lessons[:project].content_blocks.create!(block_type: :exercise, position: 1, title: "Legacy sync", filename: "app.js", submission_type: :text_submission)
    block.update_columns(submission_type: nil)
    block.reload
  end

  def service(user)
    CurriculumCopyForCohort.new(cohort: @f.cohort, user: user, source_curriculum_id: @f.curriculum.id)
  end

  def copy!(user)
    service(user).copy!
  end

  # Each learner's view, by lesson title (titles are unique in the fixture).
  def learner_views
    Enrollment.where(cohort_id: @f.cohort.id).order(:id).to_h do |enrollment|
      progress = LearnerProgress.new(Enrollment.find(enrollment.id), now: Time.zone.local(2026, 11, 16, 12))
      [ enrollment.user_id, {
        lessons: progress.lessons.map { |lesson| entry = progress.lesson_progress(lesson); [ lesson.title, entry.status, entry.available, entry.completed_blocks, entry.total_blocks, entry.required ] },
        overall: progress.overall,
        next: progress.next_lesson&.title
      } ]
    end
  end

  def other_cohort_rows
    enrollment_ids = @f.other_cohort.enrollments.ids
    {
      cohort: @f.other_cohort.reload.attributes.except("updated_at"),
      schedules: CohortModuleSchedule.where(cohort_id: @f.other_cohort.id).map(&:attributes),
      windows: CohortModuleSubmissionWindow.where(cohort_id: @f.other_cohort.id).map(&:attributes),
      rows: [ ModuleAssignment, LessonAssignment, Progress, Submission, KnowledgeCheckAttempt ].to_h { |model| [ model.name, model.where(enrollment_id: enrollment_ids).order(:id).map(&:attributes) ] },
      results: SubmissionCriterionResult.where(submission_id: Submission.where(enrollment_id: enrollment_ids).select(:id)).map(&:attributes),
      help: HelpRequest.where(cohort_id: @f.other_cohort.id).order(:id).map(&:attributes),
      messages: Message.where(direct_conversation_id: DirectConversation.where(cohort_id: @f.other_cohort.id).select(:id)).order(:id).map(&:attributes),
      notifications: Notification.where(user_id: @f.other_learner.id).order(:id).map(&:attributes),
      events: ActivityEvent.where(cohort_id: @f.other_cohort.id).order(:id).map(&:attributes)
    }
  end

  def shared_tree
    module_ids = @f.curriculum.modules.ids
    lesson_ids = Lesson.where(module_id: module_ids).ids
    [ @f.curriculum.reload.attributes, CurriculumModule.where(id: module_ids).order(:id).map(&:attributes),
      Lesson.where(id: lesson_ids).order(:id).map(&:attributes), ContentBlock.where(lesson_id: lesson_ids).order(:id).map(&:attributes),
      KnowledgeCheck.where(content_block_id: ContentBlock.where(lesson_id: lesson_ids).select(:id)).map(&:attributes),
      @f.curriculum.curriculum_resources.order(:id).map(&:attributes), @f.curriculum.rubrics.map(&:attributes), @f.curriculum.learning_objectives.map(&:attributes) ]
  end

  # Every row any copy could touch, for "nothing changed" checks.
  def everything
    tables = %w[curricula modules lessons content_blocks knowledge_checks learning_objectives rubrics rubric_criteria objective_alignments curriculum_resources
      cohorts cohort_module_schedules cohort_module_submission_windows module_assignments lesson_assignments progresses submissions
      submission_criterion_results knowledge_check_attempts learning_plans learning_plan_revisions help_requests messages notifications
      activity_events enrollments curriculum_copies content_redirects github_check_runs]
    connection = ActiveRecord::Base.connection
    tables.to_h { |table| [ table, connection.select_all("SELECT * FROM #{connection.quote_table_name(table)} ORDER BY id").rows ] }
  end
end
