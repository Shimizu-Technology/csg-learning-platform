# "Make a copy for this cohort" (T-12, W5 PR 5.3 part 2b; decision 1 in
# docs/design/2026-11-platform-redesign/README.md §12).
#
# A cohort that shares its curriculum with other cohorts gets its own copy:
# the whole curriculum is copied, the cohort switches to the copy, and that
# cohort's learner data moves onto the copy's ids. The copy keeps the
# cohort's progress, submissions and release dates; later changes to the
# shared version don't reach it. Other cohorts keep the shared curriculum and
# none of their rows change.
#
# What is copied (new rows): the curriculum (package key cleared, see
# below), learning objectives, rubrics and criteria, modules, lessons
# (archived ones too, since learner work can sit on them), blocks, knowledge
# checks (options are stored on the check), objective alignments and ready
# course files.
#
# Media is shared by reference, not copied:
# - Hosted lesson videos (content_blocks.s3_video_key): S3ObjectCleanup only
#   deletes an object once no block references it, so two blocks can name
#   one object (LessonDuplicate does the same). Each key is verified in
#   storage, taking its advisory lock, before any row lock (lock order 0).
# - Course files (curriculum_resources.s3_key): published ZIPs are never
#   deleted (abandon refuses ready files, and a curriculum with files can't
#   be destroyed), so the copy's row names the same object. Pending uploads
#   belong to the shared curriculum's draft and aren't copied.
# Copying objects would double storage and leave orphans behind on a
# rollback; a shared reference is free and rolls back cleanly.
#
# The course package key is unique and identifies the shared curriculum for
# re-imports, so the copy has none (a re-import updates the shared version
# only). Revision, digest and snapshot are kept for reference.
#
# Learner data (TABLES below lists every table that references content ids,
# from the schema, with what happens to each). Rows are updated in place, so
# submission, help request, follow-up and progress ids never change and links
# to them keep working. "The cohort's learners" are its enrollments in any
# status. Rows without an enrollment (older data) move only when that learner
# has no other enrollment on the shared curriculum; otherwise the copy is
# blocked, because nothing says which cohort the row belongs to.
#
# Old ids keep resolving: each copied module, lesson, block and knowledge
# check gets a ContentRedirect for this cohort (MovedContent), so installed
# apps, delivered notifications and sent links still open the right lesson.
#
# One transaction, with SET LOCAL lock_timeout and statement_timeout (below):
# a copy that waits too long on someone else's lock, or runs a statement too
# long, rolls back whole and the request answers 409 "busy, try again".
#
# Lock order. Every transaction below takes its locks in this order (a prefix
# of it, skipping what it doesn't need), so none can hold a lock another is
# waiting for:
#
#   0. Hosted video keys' advisory locks (copy only, after the storage check).
#   1. The shared curriculum FOR UPDATE (copy; authors take FOR SHARE).
#   2. The copying instructor's grant rows FOR SHARE (LessonEditAccess).
#   3. The cohort FOR NO KEY UPDATE (copy). Not FOR UPDATE: every learner
#      write that records an activity event inserts a row whose cohort_id
#      foreign key takes FOR KEY SHARE on the cohort while it holds its
#      enrollment, and FOR UPDATE would conflict with that and
#      deadlock against step 4. FOR NO KEY UPDATE still serializes copies and
#      waits for (and blocks) help requests and lesson message sources, which
#      take the cohort FOR SHARE.
#   4. The cohort's enrollments FOR NO KEY UPDATE, ascending (copy). Learner
#      writes take their one enrollment FOR UPDATE first
#      (Enrollment#with_learning_write_guard), so a write already past the
#      guard finishes before the copy goes on, and one that arrives later
#      waits and is then refused with content_moved.
#   5. Modules, lessons and blocks of the shared curriculum FOR SHARE,
#      ascending (copy). Authors' saves (FOR NO KEY UPDATE / FOR UPDATE) wait;
#      learner writes in other cohorts take FOR KEY SHARE on their block and
#      don't. The one learner write that updates a block row (the first
#      player ping of a hosted video with no stored duration) waits.
#
# Learner write paths, each in one transaction:
#   - progress (PATCH /progress), video credit (PATCH .../video_progress),
#     checkpoint answers (POST .../attempts), submissions: enrollment FOR
#     UPDATE (step 4), then the block FOR KEY SHARE (step 5,
#     ContentBlock.lock_for_learner_write!), then inserts and updates whose
#     foreign keys take FOR KEY SHARE on the block, knowledge check, user,
#     enrollment and cohort (step 3, compatible with the copy's lock).
#   - help requests: the cohort FOR SHARE (step 3), then the insert. No
#     enrollment lock, so a copy and a help request meet only on the cohort.
#   - GitHub sync and the prework importer: enrollment (step 4) through the
#     same guard, then their blocks FOR KEY SHARE.
# The legacy import rake task takes only blocks FOR KEY SHARE and doesn't
# wait for a copy; it writes rows without an enrollment, which a copy blocks
# on (unassigned_learner_work) rather than guesses.
#
# Before commit, LearnerProgress is computed for every learner of the cohort
# before and after, with what it doesn't cover (each exercise's effective
# submission type and GitHub repository, watch credit totals, checkpoint answer
# counts) on the cohort's current curriculum; any difference rolls the whole
# copy back. Last, the enrollments' content_moved_at is set, so a learning
# write that began before the commit is refused with "reload".
#
# Safe to retry: a failure rolls everything back; a request repeated after
# success finds the cohort already on its copy and returns it. A cohort makes
# at most one copy of a given curriculum.
class CurriculumCopyForCohort
  MAX_ATTEMPTS = 3
  # Sized for Neon: a copy waits at most this long on any one lock (an
  # author's save, a learner write in flight) before it gives up and asks the
  # user to try again, and no single statement runs longer than the second.
  class_attribute :lock_timeout, instance_accessor: false, default: "5s"
  class_attribute :statement_timeout, instance_accessor: false, default: "30s"
  # cohorts.settings keys whose values are keyed by module id.
  MODULE_KEYED_SETTINGS = %w[module_github_config].freeze
  BUSY_MESSAGE = "Someone is saving changes to this curriculum or this cohort right now. Nothing was copied. Try again in a moment.".freeze
  STAGES = %i[locked content resources cohort learner_data references redirects audit verified].freeze

  # Every table with a foreign key or polymorphic/JSON reference to curriculum
  # content, and what the copy does with it. CurriculumCopyTablesTest checks
  # this list against the database catalog.
  TABLES = {
    # Copied (new rows on the copy)
    "curricula" => :copy, "learning_objectives" => :copy, "rubrics" => :copy, "rubric_criteria" => :copy,
    "modules" => :copy, "lessons" => :copy, "content_blocks" => :copy, "knowledge_checks" => :copy,
    "objective_alignments" => :copy, "curriculum_resources" => :copy,
    # The cohort's rows move to the copy's ids
    "cohorts" => :remap, "cohort_module_schedules" => :remap, "cohort_module_submission_windows" => :remap,
    "module_assignments" => :remap, "lesson_assignments" => :remap, "progresses" => :remap,
    "submissions" => :remap, "submission_criterion_results" => :remap, "knowledge_check_attempts" => :remap,
    "learning_plans" => :remap, "learning_plan_revisions" => :remap, "help_requests" => :remap,
    "messages" => :remap, "notifications" => :remap, "activity_events" => :remap,
    # Kept as they are
    "github_check_runs" => :keep,      # keyed by submission, whose id doesn't change
    "watch_progresses" => :keep,       # class recordings belong to the cohort, not the curriculum
    "interventions" => :keep,          # evidence_snapshot is a dated record; its links still resolve
    "enrollment_restarts" => :keep,    # snapshot of removed rows, never restored
    "curriculum_copies" => :keep,      # bookkeeping
    "content_redirects" => :keep       # bookkeeping
  }.freeze

  class Blocked < StandardError
    attr_reader :code

    def initialize(code, message)
      super(message)
      @code = code
    end
  end

  class VerificationFailed < StandardError; end

  # Raised inside the transaction to restart from the storage checks.
  class MediaChanged < StandardError; end

  Result = Data.define(:copy, :already_copied, :counts, :lesson_ids)

  # Test hook: called with each stage name as it completes, inside the
  # transaction (rollback tests raise from it). Nil in production.
  class_attribute :stage_hook, instance_accessor: false, default: nil

  def initialize(cohort:, user:, source_curriculum_id:)
    @cohort = cohort
    @user = user
    @source_id = Integer(source_curriculum_id.to_s, 10, exception: false)
  end

  # Dry run: what the copy would move, and anything that blocks it. No locks,
  # no writes.
  def preview
    ApplicationRecord.uncached do
      cohort = Cohort.find(@cohort.id)
      existing = existing_copy(cohort)
      source = Curriculum.find_by(id: @source_id)
      blockers = existing ? [] : blockers_for(cohort, source)
      {
        cohort: { id: cohort.id, name: cohort.name },
        source_curriculum: source && { id: source.id, name: source.name },
        copy_name: source && copy_name(source, cohort),
        shared_with: source ? Cohort.where(curriculum_id: source.id).where.not(id: cohort.id).order(:start_date, :id).map { |other| { id: other.id, name: other.name } } : [],
        already_copied: existing.present?,
        copy_curriculum_id: existing&.copy_curriculum_id,
        can_copy: existing.nil? && blockers.empty?,
        blockers: blockers.map { |code, message| { code: code, message: message } },
        counts: source && !existing ? planned_counts(cohort, source) : (existing&.counts || {})
      }
    end
  end

  def copy!
    attempts = 0
    begin
      attempts += 1
      copy_once!
    rescue MediaChanged
      retry if attempts < MAX_ATTEMPTS
      raise Blocked.new("media_changed", "Videos in this curriculum kept changing while it was being copied. Try again.")
    rescue ActiveRecord::LockWaitTimeout, ActiveRecord::QueryCanceled, ActiveRecord::Deadlocked => error
      Rails.logger.warn("[CurriculumCopy] busy cohort_id=#{@cohort.id} #{error.class}: #{error.message.lines.first&.strip}")
      raise Blocked.new("busy", BUSY_MESSAGE)
    end
  end

  private

  # --- The copy ---------------------------------------------------------------

  def copy_once!
    ApplicationRecord.transaction do
      @now = Time.current
      set_timeouts!
      verified = verify_video_keys!
      lock!
      cohort = @locked_cohort
      if (existing = existing_copy(cohort))
        return Result.new(copy: existing, already_copied: true, counts: existing.counts, lesson_ids: existing_lesson_ids(existing))
      end

      blockers = blockers_for(cohort, @source)
      raise Blocked.new(*blockers.first) if blockers.any?
      raise MediaChanged if ContentBlock.where(id: @block_ids).where.not(s3_video_key: [ nil, "" ]).distinct.pluck(:s3_video_key).any? { |key| !verified[key] }

      stage!(:locked)
      @counts = {}
      learners_before = progress_signatures(@enrollment_ids)

      copy_content!(cohort)
      stage!(:content)
      copy_resources!
      stage!(:resources)
      move_cohort!(cohort)
      stage!(:cohort)
      remap_learner_data!
      stage!(:learner_data)
      remap_references!
      stage!(:references)
      record = record_copy!
      stage!(:redirects)
      audit!(record)
      stage!(:audit)
      verify!(learners_before)
      stage!(:verified)
      # Last statement: writes that started before this point read the old ids.
      Enrollment.where(id: @enrollment_ids).update_all("content_moved_at = clock_timestamp()") if @enrollment_ids.any?

      Result.new(copy: record, already_copied: false, counts: @counts, lesson_ids: @lesson_map.transform_keys(&:to_s))
    end
  end

  def stage!(name)
    self.class.stage_hook&.call(name)
  end

  # Transaction-scoped: they end with the copy's transaction.
  def set_timeouts!
    connection = ApplicationRecord.connection
    connection.execute("SET LOCAL lock_timeout = #{connection.quote(self.class.lock_timeout)}")
    connection.execute("SET LOCAL statement_timeout = #{connection.quote(self.class.statement_timeout)}")
  end

  # Lock order 0: every hosted video key the copy will reference, in storage,
  # before any row lock (sorted, so two copies take the advisory locks in the
  # same order).
  def verify_video_keys!
    keys = ApplicationRecord.uncached do
      ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: @source_id })
        .where.not(s3_video_key: [ nil, "" ]).distinct.pluck(:s3_video_key).sort
    end
    keys.to_h do |key|
      problem = S3ObjectCleanup.verify_attachment(key)
      raise Blocked.new("media_missing", "A hosted video in this curriculum #{problem}, so it can't be copied. Replace that video, then try again.") if problem

      [ key, true ]
    end
  end

  def lock!
    raise Blocked.new("source_missing", "Choose the curriculum this cohort uses.") unless @source_id

    Curriculum.lock_for_content!(@source_id, "FOR UPDATE")
    @source = Curriculum.find(@source_id)
    @access = LessonEditAccess.for(@user, @source, lock: true)
    # Lock order steps 3-5 (see the top of this file).
    @locked_cohort = Cohort.lock("FOR NO KEY UPDATE").find(@cohort.id)
    @enrollment_ids = Enrollment.where(cohort_id: @locked_cohort.id).order(:id).lock("FOR NO KEY UPDATE").pluck(:id)
    @module_ids = CurriculumModule.where(curriculum_id: @source_id).order(:id).lock("FOR SHARE").pluck(:id)
    @lesson_ids = Lesson.where(module_id: @module_ids).order(:id).lock("FOR SHARE").pluck(:id)
    @block_ids = ContentBlock.where(lesson_id: @lesson_ids).order(:id).lock("FOR SHARE").pluck(:id)
  end

  def copy_content!(cohort)
    @copy = Curriculum.create!(
      @source.attributes.except("id", "course_package_key", "created_at", "updated_at").merge("name" => copy_name(@source, cohort))
    )

    @objective_map = copy_rows(LearningObjective, LearningObjective.where(curriculum_id: @source_id)) { |row| row["curriculum_id"] = @copy.id }
    @rubric_map = copy_rows(Rubric, Rubric.where(curriculum_id: @source_id)) { |row| row["curriculum_id"] = @copy.id }
    @criterion_map = copy_rows(RubricCriterion, RubricCriterion.where(rubric_id: @rubric_map.keys)) do |row|
      row["rubric_id"] = @rubric_map.fetch(row["rubric_id"])
      row["learning_objective_id"] = @objective_map.fetch(row["learning_objective_id"], row["learning_objective_id"])
    end
    @module_map = copy_rows(CurriculumModule, CurriculumModule.where(id: @module_ids)) { |row| row["curriculum_id"] = @copy.id }
    @lesson_map = copy_rows(Lesson, Lesson.where(id: @lesson_ids)) { |row| row["module_id"] = @module_map.fetch(row["module_id"]) }
    @block_map = allocate_map(ContentBlock, @block_ids)
    @block_map = copy_rows(ContentBlock, ContentBlock.where(id: @block_ids), map: @block_map) do |row|
      row["lesson_id"] = @lesson_map.fetch(row["lesson_id"])
      row["rubric_id"] = @rubric_map.fetch(row["rubric_id"], row["rubric_id"])
      row["body"] = rewrite_links(row["body"])
      row["solution"] = rewrite_links(row["solution"])
    end
    @check_map = copy_rows(KnowledgeCheck, KnowledgeCheck.where(content_block_id: @block_ids)) do |row|
      row["content_block_id"] = @block_map.fetch(row["content_block_id"])
      row["learning_objective_id"] = @objective_map.fetch(row["learning_objective_id"], row["learning_objective_id"])
    end
    alignments = copy_rows(ObjectiveAlignment, ObjectiveAlignment.where(lesson_id: @lesson_ids)) do |row|
      row["lesson_id"] = @lesson_map.fetch(row["lesson_id"])
      row["content_block_id"] = @block_map.fetch(row["content_block_id"]) if row["content_block_id"]
      row["learning_objective_id"] = @objective_map.fetch(row["learning_objective_id"], row["learning_objective_id"])
    end

    @counts.merge!(
      "modules" => @module_map.size, "lessons" => @lesson_map.size, "content_blocks" => @block_map.size,
      "learning_objectives" => @objective_map.size, "rubrics" => @rubric_map.size, "rubric_criteria" => @criterion_map.size,
      "knowledge_checks" => @check_map.size, "objective_alignments" => alignments.size
    )
  end

  # Ready course files only; the copy names the same stored ZIP.
  def copy_resources!
    resources = copy_rows(CurriculumResource, CurriculumResource.where(curriculum_id: @source_id, ready: true)) do |row|
      row["curriculum_id"] = @copy.id
      row["upload_key"] = "course_resource_uploads/curriculum_#{@copy.id}/#{SecureRandom.uuid}/#{row['filename']}"
    end
    @counts["curriculum_resources"] = resources.size
  end

  # The cohort's curriculum, and its module-keyed JSON: content_defaults and
  # the settings in MODULE_KEYED_SETTINGS (per-module GitHub requirement and
  # repository). Every other setting is kept as it is; settings are written
  # directly so Cohort's class-resource callback doesn't restamp them.
  def move_cohort!(cohort)
    cohort.update!(curriculum_id: @copy.id, content_defaults: remap_module_keys(cohort.content_defaults))
    settings = remap_module_settings(cohort.settings)
    cohort.update_columns(settings: settings) if settings != cohort.settings
    @counts["cohorts"] = 1
    @counts["cohort_module_schedules"] = remap_column(CohortModuleSchedule.where(cohort_id: cohort.id), :module_id, @module_map)
    @counts["cohort_module_submission_windows"] = remap_column(CohortModuleSubmissionWindow.where(cohort_id: cohort.id), :module_id, @module_map)
  end

  def remap_learner_data!
    @counts["module_assignments"] = remap_column(ModuleAssignment.where(enrollment_id: @enrollment_ids), :module_id, @module_map)
    @counts["lesson_assignments"] = remap_column(LessonAssignment.where(enrollment_id: @enrollment_ids), :lesson_id, @lesson_map)
    progresses = learner_rows(Progress)
    @counts["progresses"] = remap_column(progresses, :content_block_id, @block_map)
    submission_ids = learner_rows(Submission).where(content_block_id: @block_map.keys).pluck(:id)
    @counts["submissions"] = remap_column(Submission.where(id: submission_ids), :content_block_id, @block_map)
    @counts["submission_criterion_results"] = remap_column(SubmissionCriterionResult.where(submission_id: submission_ids), :rubric_criterion_id, @criterion_map)
    @counts["knowledge_check_attempts"] = remap_column(learner_rows(KnowledgeCheckAttempt), :knowledge_check_id, @check_map)
    remap_learning_plans!
  end

  def remap_learning_plans!
    plans = LearningPlan.where(enrollment_id: @enrollment_ids).to_a
    changed_plans = plans.count do |plan|
      milestones = remap_milestones(plan.milestones)
      overrides = remap_overrides(plan.lesson_overrides)
      next false if milestones == plan.milestones && overrides == plan.lesson_overrides

      # Bypass validation: the plan was valid for the same lessons under their
      # old ids, and lock_version stays so an open editor isn't told it's stale.
      plan.update_columns(milestones: milestones, lesson_overrides: overrides)
      true
    end
    changed_revisions = LearningPlanRevision.where(learning_plan_id: plans.map(&:id)).to_a.count do |revision|
      snapshot = revision.snapshot.merge(
        "milestones" => remap_milestones(revision.snapshot["milestones"]),
        "lesson_overrides" => remap_overrides(revision.snapshot["lesson_overrides"])
      )
      next false if snapshot == revision.snapshot

      revision.update_columns(snapshot: snapshot)
      true
    end
    @counts["learning_plans"] = changed_plans
    @counts["learning_plan_revisions"] = changed_revisions
  end

  def remap_references!
    @counts["help_requests"] = remap_help_requests!
    @counts["messages"] = remap_messages!
    @counts["notifications"] = remap_notifications!
    @counts["activity_events"] = remap_column(
      ActivityEvent.where(cohort_id: @locked_cohort.id, record_type: "ContentBlock"), :record_id, @block_map
    )
  end

  def remap_help_requests!
    HelpRequest.where(cohort_id: @locked_cohort.id, context_type: %w[lesson exercise]).to_a.count do |request|
      map = request.context_type_lesson? ? @lesson_map : @block_map
      new_id = map[request.context_id]
      next false unless new_id

      request.update_columns(context_id: new_id, context_path: rewrite_path(request.context_path))
      true
    end
  end

  # "Ask about this lesson" messages in this cohort's channels and direct
  # conversations (#244, #253). Messages elsewhere stay on the shared lesson;
  # MovedContent still resolves them for this cohort's learners.
  def remap_messages!
    channel_ids = Channel.where(cohort_id: @locked_cohort.id).select(:id)
    conversation_ids = DirectConversation.where(cohort_id: @locked_cohort.id).select(:id)
    scope = Message.where(source_type: "Lesson", source_id: @lesson_map.keys)
      .where(channel_id: channel_ids).or(Message.where(source_type: "Lesson", source_id: @lesson_map.keys, direct_conversation_id: conversation_ids))
    remap_column(scope, :source_id, @lesson_map)
  end

  # Stored links (/lessons/:id?cohort_id=…#block-…) for this cohort's
  # learners. A link naming another cohort, or none for a learner who also
  # has a cohort still on the shared curriculum, keeps the shared lesson.
  def remap_notifications!
    user_ids = Enrollment.where(id: @enrollment_ids).pluck(:user_id)
    return 0 if user_ids.empty?

    shared_user_ids = Enrollment.joins(:cohort).where(user_id: user_ids, cohorts: { curriculum_id: @source_id }).where.not(cohort_id: @locked_cohort.id).distinct.pluck(:user_id).to_set
    Notification.where(user_id: user_ids).where("path LIKE '/lessons/%'").to_a.count do |notification|
      cohort_param = notification.path[/[?&]cohort_id=(\d+)/, 1]&.to_i
      next false if cohort_param && cohort_param != @locked_cohort.id
      next false if cohort_param.nil? && shared_user_ids.include?(notification.user_id)

      path = rewrite_path(notification.path)
      next false if path == notification.path

      notification.update_columns(path: path)
      true
    end
  end

  def record_copy!
    record = CurriculumCopy.create!(
      cohort: @locked_cohort, source_curriculum_id: @source_id, copy_curriculum: @copy, created_by: @user, counts: @counts, created_at: @now
    )
    rows = { "CurriculumModule" => @module_map, "Lesson" => @lesson_map, "ContentBlock" => @block_map, "KnowledgeCheck" => @check_map }.flat_map do |type, map|
      map.map { |old_id, new_id| { curriculum_copy_id: record.id, cohort_id: @locked_cohort.id, record_type: type, old_id: old_id, new_id: new_id, created_at: @now } }
    end
    rows.each_slice(1_000) { |slice| ContentRedirect.insert_all!(slice) }
    record
  end

  # Grants live on the cohort's assignment rows, so an instructor's editing
  # access now covers the cohort's own copy. The ActivityEvent is the staff
  # audit line; the CurriculumCopy row holds the details.
  def audit!(record)
    ActivityEvent.record!(event_type: "curriculum_copied", actor: @user, subject_user: @user, cohort: @locked_cohort)
    record
  end

  # Before vs after, per learner: every lesson's status, counts and window,
  # every module's, the overall counts and the next step (LearnerProgress);
  # each exercise's effective submission type and GitHub repository; watch
  # credit totals and checkpoint answer counts on the cohort's curriculum.
  # Old ids are translated. Any difference rolls the copy back. The query
  # count is bounded: LearnerProgress per learner, plus a fixed few for all.
  def verify!(before)
    before = before.transform_values { |signature| translate_signature(signature) }
    after = progress_signatures(@enrollment_ids)
    return if before == after

    differing = before.keys.select { |id| before[id] != after[id] }
    raise VerificationFailed, "Learner progress would change for #{differing.size} #{'learner'.pluralize(differing.size)} (enrollments #{differing.first(5).join(', ')}), so nothing was copied."
  end

  def progress_signatures(enrollment_ids)
    ApplicationRecord.uncached do
      enrollments = Enrollment.where(id: enrollment_ids).includes(:cohort).order(:id).to_a
      school = FeatureSwitches.school
      curriculum_id = enrollments.first&.cohort&.curriculum_id
      evidence = evidence_totals(enrollment_ids, curriculum_id)
      # The cohort's curriculum tree, loaded once for all its learners.
      modules = curriculum_id ? Curriculum.find(curriculum_id).modules.to_a : []
      ActiveRecord::Associations::Preloader.new(records: modules, associations: { lessons: :content_blocks }).call
      enrollments.to_h do |enrollment|
        [ enrollment.id, progress_signature(enrollment, modules, school).merge(evidence.fetch(enrollment.id, { watch: [ 0, 0.0, 0 ], answers: [] })) ]
      end
    end
  end

  # Watch credit and checkpoint answers on blocks of the cohort's current
  # curriculum, so a row left on the other curriculum's ids shows as missing.
  def evidence_totals(enrollment_ids, curriculum_id)
    return {} if enrollment_ids.empty? || curriculum_id.nil?

    block_ids = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: curriculum_id }).select(:id)
    result = Hash.new { |hash, id| hash[id] = { watch: [ 0, 0.0, 0 ], answers: [] } }
    Progress.where(enrollment_id: enrollment_ids, content_block_id: block_ids).group(:enrollment_id)
      .pluck(:enrollment_id, Arel.sql("COUNT(watch_credit_at)"), Arel.sql("ROUND(COALESCE(SUM(watch_credit_fraction), 0)::numeric, 6)"), Arel.sql("COALESCE(SUM(video_total_watched), 0)"))
      .each { |id, credited, fraction, watched| result[id][:watch] = [ credited.to_i, fraction.to_f, watched.to_i ] }
    KnowledgeCheckAttempt.where(enrollment_id: enrollment_ids, knowledge_check_id: KnowledgeCheck.where(content_block_id: block_ids).select(:id))
      .group(:enrollment_id, :knowledge_check_id).order(:enrollment_id, :knowledge_check_id)
      .pluck(:enrollment_id, :knowledge_check_id, Arel.sql("COUNT(*)"), Arel.sql("COUNT(*) FILTER (WHERE correct)"))
      .each { |id, check_id, count, correct| result[id][:answers] << [ check_id, count.to_i, correct.to_i ] }
    result
  end

  def progress_signature(enrollment, modules, school)
    progress = LearnerProgress.new(enrollment, content: AssignedLearningContent.new(enrollment, modules: modules), now: @now)
    cohort = enrollment.cohort
    modules_by_id = progress.content.modules.index_by(&:id)
    github = (cohort.settings || {})["module_github_config"]
    github = {} unless github.is_a?(Hash)
    {
      exercises: progress.lessons.flat_map do |lesson|
        lesson.association(:curriculum_module).target = modules_by_id[lesson.module_id] unless lesson.association(:curriculum_module).loaded?
        config = github[lesson.module_id.to_s]
        config = {} unless config.is_a?(Hash)
        lesson.content_blocks.select(&:exercise_like?).map do |block|
          block.association(:lesson).target = lesson
          [ block.id, lesson.id, block.submission_type_for(enrollment, school: school), config["repository_name"].presence || cohort.repository_name ]
        end
      end,
      lessons: progress.lessons.map do |lesson|
        entry = progress.lesson_progress(lesson)
        [ lesson.id, lesson.module_id, entry.status, entry.review_status, entry.available, entry.required,
          entry.completed, entry.completed_blocks, entry.total_blocks, entry.submission_window ]
      end,
      modules: progress.content.modules.map do |mod|
        entry = progress.module_progress(mod)
        [ mod.id, entry.status, entry.completed_blocks, entry.total_blocks ]
      end,
      overall: progress.overall,
      next_lesson: progress.next_lesson&.id,
      redo_submissions: progress.redo_submissions.map(&:id)
    }
  end

  # A signature taken before the copy, in the copy's ids.
  def translate_signature(signature)
    lesson_id = ->(id) { @lesson_map.fetch(id, id) }
    module_id = ->(id) { @module_map.fetch(id, id) }
    signature.merge(
      exercises: signature[:exercises].map { |row| [ @block_map.fetch(row[0], row[0]), lesson_id.call(row[1]), *row.drop(2) ] },
      answers: signature[:answers].map { |row| [ @check_map.fetch(row[0], row[0]), *row.drop(1) ] }.sort,
      lessons: signature[:lessons].map { |row| [ lesson_id.call(row[0]), module_id.call(row[1]), *row.drop(2) ] },
      modules: signature[:modules].map { |row| [ module_id.call(row[0]), *row.drop(1) ] },
      next_lesson: signature[:next_lesson] && lesson_id.call(signature[:next_lesson])
    )
  end

  # --- Checks and counts ------------------------------------------------------

  def existing_copy(cohort)
    return nil unless @source_id

    copy = CurriculumCopy.find_by(cohort_id: cohort.id, source_curriculum_id: @source_id)
    copy if copy && cohort.curriculum_id == copy.copy_curriculum_id
  end

  def existing_lesson_ids(copy)
    copy.content_redirects.where(record_type: "Lesson").pluck(:old_id, :new_id).to_h { |old_id, new_id| [ old_id.to_s, new_id ] }
  end

  # [[code, message], ...]; empty when the copy can go ahead.
  def blockers_for(cohort, source)
    return [ [ "source_missing", "That curriculum no longer exists." ] ] unless source
    return [ [ "source_changed", "#{cohort.name} no longer uses #{source.name}. Reload to see its current curriculum." ] ] unless cohort.curriculum_id == source.id

    blockers = []
    access = @access || LessonEditAccess.for(@user, source)
    unless @user&.admin? && !@user.archived?
      unless access.reason == "shared" && access.copy_cohorts.any? { |granted| granted.id == cohort.id }
        return [ [ "copy_not_needed", "#{cohort.name} is the only cohort using #{source.name}, so you can edit it directly." ] ] if access.reason == "granted"

        return [ [ "not_allowed", "Only admins and instructors with editing access for #{cohort.name} can make its copy." ] ]
      end
    end
    unless Cohort.where(curriculum_id: source.id).where.not(id: cohort.id).exists?
      return [ [ "copy_not_needed", "#{cohort.name} is the only cohort using #{source.name}, so you can edit it directly." ] ]
    end
    blockers << [ "source_archived", "#{source.name} is archived. Restore it before making a copy." ] if source.archived?
    if CurriculumCopy.where(cohort_id: cohort.id, source_curriculum_id: source.id).exists?
      blockers << [ "copied_before", "#{cohort.name} already has a copy of #{source.name}. Move the cohort to that copy instead of making another." ]
    end
    unclaimed = unclaimed_legacy_rows(cohort, source)
    if unclaimed.positive?
      blockers << [ "unassigned_learner_work",
        "#{ActionController::Base.helpers.pluralize(unclaimed, 'older progress or work record')} in #{source.name} belong to learners who are also in another cohort using it, " \
        "and they aren't linked to a cohort, so they can't be moved safely. Ask an admin to link them to a cohort first." ]
    end
    blockers
  end

  # Rows with no enrollment, on this curriculum, for learners of the cohort
  # who are also enrolled in another cohort on it.
  def unclaimed_legacy_rows(cohort, source)
    user_ids = Enrollment.where(cohort_id: cohort.id).pluck(:user_id)
    return 0 if user_ids.empty?

    shared = Enrollment.joins(:cohort).where(user_id: user_ids, cohorts: { curriculum_id: source.id }).where.not(cohort_id: cohort.id).distinct.pluck(:user_id)
    return 0 if shared.empty?

    block_ids = ContentBlock.joins(lesson: :curriculum_module).where(modules: { curriculum_id: source.id }).select(:id)
    check_ids = KnowledgeCheck.where(content_block_id: block_ids).select(:id)
    Progress.where(enrollment_id: nil, user_id: shared, content_block_id: block_ids).count +
      Submission.where(enrollment_id: nil, user_id: shared, content_block_id: block_ids).count +
      KnowledgeCheckAttempt.where(enrollment_id: nil, user_id: shared, knowledge_check_id: check_ids).count
  end

  # The same numbers the copy records, from a read-only pass.
  def planned_counts(cohort, source)
    module_ids = CurriculumModule.where(curriculum_id: source.id).pluck(:id)
    lesson_ids = Lesson.where(module_id: module_ids).pluck(:id)
    block_ids = ContentBlock.where(lesson_id: lesson_ids).pluck(:id)
    check_ids = KnowledgeCheck.where(content_block_id: block_ids).pluck(:id)
    rubric_ids = Rubric.where(curriculum_id: source.id).pluck(:id)
    criterion_ids = RubricCriterion.where(rubric_id: rubric_ids).pluck(:id)
    enrollment_ids = Enrollment.where(cohort_id: cohort.id).pluck(:id)
    legacy = legacy_user_ids(enrollment_ids, source.id, cohort.id)
    rows = ->(model, column, ids) { learner_scope(model, enrollment_ids, legacy).where(column => ids) }
    submission_ids = rows.call(Submission, :content_block_id, block_ids).pluck(:id)
    plans = LearningPlan.where(enrollment_id: enrollment_ids).to_a
    lesson_set = lesson_ids.to_set
    plan_touches = ->(snapshot) { plan_lesson_ids(snapshot).any? { |id| lesson_set.include?(id) } }
    {
      "modules" => module_ids.size, "lessons" => lesson_ids.size, "content_blocks" => block_ids.size,
      "learning_objectives" => LearningObjective.where(curriculum_id: source.id).count, "rubrics" => rubric_ids.size,
      "rubric_criteria" => criterion_ids.size, "knowledge_checks" => check_ids.size,
      "objective_alignments" => ObjectiveAlignment.where(lesson_id: lesson_ids).count,
      "curriculum_resources" => CurriculumResource.where(curriculum_id: source.id, ready: true).count,
      "cohorts" => 1,
      "cohort_module_schedules" => CohortModuleSchedule.where(cohort_id: cohort.id, module_id: module_ids).count,
      "cohort_module_submission_windows" => CohortModuleSubmissionWindow.where(cohort_id: cohort.id, module_id: module_ids).count,
      "module_assignments" => ModuleAssignment.where(enrollment_id: enrollment_ids, module_id: module_ids).count,
      "lesson_assignments" => LessonAssignment.where(enrollment_id: enrollment_ids, lesson_id: lesson_ids).count,
      "progresses" => rows.call(Progress, :content_block_id, block_ids).count,
      "submissions" => submission_ids.size,
      "submission_criterion_results" => SubmissionCriterionResult.where(submission_id: submission_ids, rubric_criterion_id: criterion_ids).count,
      "knowledge_check_attempts" => rows.call(KnowledgeCheckAttempt, :knowledge_check_id, check_ids).count,
      "learning_plans" => plans.count { |plan| plan_touches.call(plan.snapshot) },
      "learning_plan_revisions" => LearningPlanRevision.where(learning_plan_id: plans.map(&:id)).to_a.count { |revision| plan_touches.call(revision.snapshot) },
      "help_requests" => HelpRequest.where(cohort_id: cohort.id).where(context_type: "lesson", context_id: lesson_ids)
        .or(HelpRequest.where(cohort_id: cohort.id, context_type: "exercise", context_id: block_ids)).count,
      "messages" => Message.where(source_type: "Lesson", source_id: lesson_ids)
        .where(channel_id: Channel.where(cohort_id: cohort.id).select(:id))
        .or(Message.where(source_type: "Lesson", source_id: lesson_ids, direct_conversation_id: DirectConversation.where(cohort_id: cohort.id).select(:id))).count,
      "notifications" => planned_notifications(cohort, source, enrollment_ids, lesson_set),
      "activity_events" => ActivityEvent.where(cohort_id: cohort.id, record_type: "ContentBlock", record_id: block_ids).count
    }
  end

  def planned_notifications(cohort, source, enrollment_ids, lesson_set)
    user_ids = Enrollment.where(id: enrollment_ids).pluck(:user_id)
    shared = Enrollment.joins(:cohort).where(user_id: user_ids, cohorts: { curriculum_id: source.id }).where.not(cohort_id: cohort.id).distinct.pluck(:user_id).to_set
    Notification.where(user_id: user_ids).where("path LIKE '/lessons/%'").pluck(:user_id, :path).count do |user_id, path|
      cohort_param = path[/[?&]cohort_id=(\d+)/, 1]&.to_i
      next false if cohort_param && cohort_param != cohort.id
      next false if cohort_param.nil? && shared.include?(user_id)

      lesson_set.include?(path[%r{\A/lessons/(\d+)}, 1].to_i)
    end
  end

  # --- Helpers ----------------------------------------------------------------

  def copy_name(source, cohort)
    "#{source.name} (#{cohort.name})"
  end

  # Learner rows of the cohort: its enrollments' rows, and rows without an
  # enrollment for its learners who have no other cohort on this curriculum.
  def learner_rows(model)
    @legacy_user_ids ||= legacy_user_ids(@enrollment_ids, @source_id, @locked_cohort.id)
    learner_scope(model, @enrollment_ids, @legacy_user_ids)
  end

  def learner_scope(model, enrollment_ids, legacy_user_ids)
    model.where(enrollment_id: enrollment_ids).or(model.where(enrollment_id: nil, user_id: legacy_user_ids))
  end

  def legacy_user_ids(enrollment_ids, source_id, cohort_id)
    user_ids = Enrollment.where(id: enrollment_ids).pluck(:user_id)
    shared = Enrollment.joins(:cohort).where(user_id: user_ids, cohorts: { curriculum_id: source_id }).where.not(cohort_id: cohort_id).pluck(:user_id)
    user_ids - shared
  end

  # New ids from the table's own sequence, assigned in ascending old-id order
  # so ties in position sort the same way on the copy.
  def allocate_map(model, old_ids)
    old_ids = old_ids.sort
    return {} if old_ids.empty?

    connection = model.connection
    sequence = connection.select_value("SELECT pg_get_serial_sequence(#{connection.quote(model.table_name)}, 'id')")
    new_ids = connection.select_values("SELECT nextval(#{connection.quote(sequence)}) FROM generate_series(1, #{old_ids.size.to_i})").map(&:to_i).sort
    old_ids.zip(new_ids).to_h
  end

  # Inserts a copy of each row (every column, timestamps included, so a paused
  # learner's read cutoff treats the copy as the same lesson) with new ids.
  # Returns { old_id => new_id }.
  def copy_rows(model, scope, map: nil)
    records = scope.order(:id).to_a
    map ||= allocate_map(model, records.map(&:id))
    return map if records.empty?

    rows = records.map do |record|
      row = record.attributes_before_type_cast.keys.index_with { |name| record.read_attribute(name) }
      row["id"] = map.fetch(record.id)
      yield row if block_given?
      row
    end
    rows.each_slice(500) { |slice| model.insert_all!(slice, record_timestamps: false) }
    map
  end

  # One UPDATE for the whole scope, joined to the id map; returns the number
  # of rows moved.
  def remap_column(scope, column, map)
    return 0 if map.empty?

    model = scope.klass
    table = model.quoted_table_name
    quoted = model.connection.quote_column_name(column)
    sql = model.sanitize_sql_array([
      "UPDATE #{table} SET #{quoted} = remap.new_id FROM unnest(ARRAY[?]::bigint[], ARRAY[?]::bigint[]) AS remap(old_id, new_id) " \
      "WHERE #{table}.#{quoted} = remap.old_id AND #{table}.id IN (#{scope.select(model.arel_table[:id]).to_sql})",
      map.keys, map.values
    ])
    model.connection.update(sql, "#{model.name} remap #{column}")
  end

  def remap_module_keys(hash)
    hash&.to_h&.each_with_object({}) do |(module_id, value), result|
      new_id = @module_map[module_id.to_i]
      result[new_id ? new_id.to_s : module_id] = value
    end
  end

  def remap_module_settings(settings)
    return settings unless settings.is_a?(Hash)

    MODULE_KEYED_SETTINGS.each_with_object(settings.dup) do |key, result|
      result[key] = remap_module_keys(result[key]) if result[key].is_a?(Hash)
    end
  end

  def remap_milestones(milestones)
    Array(milestones).map do |item|
      next item unless item.is_a?(Hash) && item["lesson_ids"].is_a?(Array)

      item.merge("lesson_ids" => item["lesson_ids"].map { |id| @lesson_map.fetch(id, id) })
    end
  end

  def remap_overrides(overrides)
    Array(overrides).map do |item|
      next item unless item.is_a?(Hash) && item.key?("lesson_id")

      item.merge("lesson_id" => @lesson_map.fetch(item["lesson_id"], item["lesson_id"]))
    end
  end

  def plan_lesson_ids(snapshot)
    Array(snapshot["milestones"]).flat_map { |item| item.is_a?(Hash) ? Array(item["lesson_ids"]) : [] } +
      Array(snapshot["lesson_overrides"]).filter_map { |item| item["lesson_id"] if item.is_a?(Hash) }
  end

  # /lessons/:id paths with an optional #block-:id, rewritten to the copy.
  def rewrite_path(path)
    return path if path.blank?

    path.sub(%r{\A/lessons/(\d+)}) { "/lessons/#{@lesson_map.fetch(Regexp.last_match(1).to_i, Regexp.last_match(1))}" }
      .sub(/#block-(\d+)\z/) { "#block-#{@block_map.fetch(Regexp.last_match(1).to_i, Regexp.last_match(1))}" }
  end

  # Links inside a copied lesson to other lessons and modules of the same
  # curriculum point at the copy's, so learners stay on their cohort's copy.
  def rewrite_links(text)
    return text if text.blank?

    text.gsub(%r{/(lessons|modules)/(\d+)(#block-(\d+))?}) do
      kind = Regexp.last_match(1)
      old = Regexp.last_match(2).to_i
      map = kind == "lessons" ? @lesson_map : @module_map
      next Regexp.last_match(0) unless map.key?(old)

      block = Regexp.last_match(4) && "#block-#{@block_map.fetch(Regexp.last_match(4).to_i, Regexp.last_match(4))}"
      "/#{kind}/#{map.fetch(old)}#{block}"
    end
  end
end
