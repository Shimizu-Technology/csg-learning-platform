# Where a curriculum, module or lesson is used (L-3.2, L-5): the staff record
# pages for content, and the lesson editor's "Used in" panel (L-3.1).
#
# Staff only. Students, archived accounts and unknown ids get nil, so the
# controller answers 404 and a student never learns the record exists.
#
# Who sees which cohorts:
# - Admins see every cohort that uses the curriculum.
# - Instructors see only the cohorts they teach. Other cohorts on the same
#   curriculum appear only as a number (`other_cohorts_count`), never by name,
#   and none of their submissions, help requests or copies are counted. The
#   number is there for the shared-curriculum warning (copy before edit, #276).
#
# Counts match the pages they link to: `submissions` is every attempt and
# `waiting` is latest attempts without a grade, as the Grading queue counts
# them for the same cohort, module or lesson (GradingQueue, #281). Help counts
# only cohorts with help requests switched on.
#
# Rows carry names, dates and counts only, never answers, questions or
# feedback. The query count does not grow with the number of cohorts, modules,
# lessons, submissions, rubrics, objectives, copies or activity events.
class RecordUsage
  TYPES = %w[curriculum module lesson].freeze
  HELP_LIST_LIMIT = 5 # per cohort
  ACTIVITY_LIST_LIMIT = 10

  def self.for(viewer:, type:, id:)
    new(viewer: viewer, type: type, id: id).call
  end

  def initialize(viewer:, type:, id:)
    @viewer = viewer
    @type = type.to_s
    number = Integer(id.to_s, 10, exception: false)
    @id = number if number&.positive?
  end

  def call
    return nil if @viewer.nil? || @viewer.archived? || !@viewer.staff? || @id.nil?
    return nil unless TYPES.include?(@type)

    send("#{@type}_usage")
  end

  private

  # --- Curriculum ------------------------------------------------------------

  def curriculum_usage
    curriculum = Curriculum.find_by(id: @id)
    return nil unless curriculum

    cohorts = visible_cohorts(curriculum.id)
    modules = curriculum.modules.to_a
    lesson_counts = Lesson.active.where(module_id: modules.map(&:id)).group(:module_id).count
    students = Enrollment.active.where(cohort_id: cohorts.map(&:id)).group(:cohort_id).count
    waiting = waiting_by_cohort(cohorts, Submission.all)
    help = help_by_cohort(cohorts, HelpRequest.all)

    {
      type: "curriculum",
      id: curriculum.id,
      name: names.for(curriculum),
      description: curriculum.description,
      status: curriculum.status,
      total_weeks: curriculum.total_weeks,
      imported: curriculum.course_package_key.present?,
      package_revision: curriculum.course_package_revision,
      package_key: curriculum.course_package_key,
      can_edit: LessonEditAccess.for(@viewer, curriculum).can_edit?,
      modules: modules.map do |mod|
        { id: mod.id, name: mod.name, module_type: mod.module_type, position: mod.position,
          scheduled_day_names: mod.scheduled_day_names, lessons_count: lesson_counts.fetch(mod.id, 0) }
      end,
      cohorts: cohorts.map do |cohort|
        cohort_json(cohort).merge(
          students: students.fetch(cohort.id, 0),
          waiting: waiting.fetch(cohort.id, 0),
          open_help: help[cohort.id]
        )
      end,
      other_cohorts_count: @other_cohorts_count,
      copy_of: copy_of(curriculum),
      **copies(curriculum),
      rubrics: rubrics(curriculum),
      objectives: objectives(curriculum),
      totals: {
        waiting: waiting.values.sum,
        open_help: help_total(help),
        resources: curriculum.curriculum_resources.count
      }
    }
  end

  # Where this curriculum came from, when it is one cohort's own copy. An
  # instructor who doesn't teach that cohort sees the source, not the cohort.
  def copy_of(curriculum)
    record = CurriculumCopy.includes(:source_curriculum, :created_by).find_by(copy_curriculum_id: curriculum.id)
    return nil unless record

    cohort = cohort_visible?(record.cohort_id) ? Cohort.find_by(id: record.cohort_id) : nil
    {
      cohort: cohort && { id: cohort.id, name: cohort.name },
      source_curriculum: names.ref(record.source_curriculum),
      created_by: record.created_by && { id: record.created_by.id, name: record.created_by.full_name },
      created_at: record.created_at.iso8601
    }
  end

  # Copies made from this curriculum ("Make a copy for this cohort", #276).
  def copies(curriculum)
    records = CurriculumCopy.includes(:cohort, :copy_curriculum, :created_by)
      .where(source_curriculum_id: curriculum.id).order(created_at: :desc, id: :desc).to_a
    shown = records.select { |record| cohort_visible?(record.cohort_id) }
    names.preload(shown.map(&:copy_curriculum_id))
    {
      copies: shown.map do |record|
        {
          id: record.id,
          cohort: { id: record.cohort.id, name: record.cohort.name },
          copy_curriculum: names.ref(record.copy_curriculum),
          created_by: record.created_by && { id: record.created_by.id, name: record.created_by.full_name },
          created_at: record.created_at.iso8601,
          lessons_count: record.counts.is_a?(Hash) ? record.counts["lessons"] : nil
        }
      end,
      other_copies_count: records.size - shown.size
    }
  end

  # Each rubric and the lessons whose exercises use it.
  def rubrics(curriculum)
    rubrics = curriculum.rubrics.order(:title, :id).to_a
    ids = rubrics.map(&:id)
    criteria = RubricCriterion.where(rubric_id: ids).group(:rubric_id).count
    uses = ContentBlock.joins(:lesson).where(rubric_id: ids)
      .order("lessons.module_id", "lessons.release_day", "lessons.position", "lessons.id")
      .pluck(:rubric_id, "lessons.id", "lessons.title", "lessons.module_id", Arel.sql("lessons.archived_at IS NOT NULL"))
      .group_by(&:first)
    rubrics.map do |rubric|
      { id: rubric.id, title: rubric.title, active: rubric.active, criteria_count: criteria.fetch(rubric.id, 0),
        lessons: lesson_refs(uses.fetch(rubric.id, [])) }
    end
  end

  # Each learning objective and the lessons aligned to it or checking it.
  def objectives(curriculum)
    objectives = curriculum.learning_objectives.to_a
    ids = objectives.map(&:id)
    order = [ "lessons.module_id", "lessons.release_day", "lessons.position", "lessons.id" ]
    columns = [ "lessons.id", "lessons.title", "lessons.module_id", Arel.sql("lessons.archived_at IS NOT NULL") ]
    aligned = ObjectiveAlignment.joins(:lesson).where(learning_objective_id: ids).order(*order).pluck(:learning_objective_id, *columns)
    checked = KnowledgeCheck.joins(content_block: :lesson).where(learning_objective_id: ids).order(*order).pluck(:learning_objective_id, *columns)
    uses = (aligned + checked).group_by(&:first)
    objectives.map do |objective|
      { id: objective.id, code: objective.code, title: objective.title, active: objective.active,
        lessons: lesson_refs(uses.fetch(objective.id, [])) }
    end
  end

  def lesson_refs(rows)
    rows.uniq { |row| row[1] }.map do |_, id, title, module_id, archived|
      { id: id, title: title, module_id: module_id, archived: archived }
    end
  end

  # --- Module ----------------------------------------------------------------

  def module_usage
    mod = CurriculumModule.includes(:curriculum).find_by(id: @id)
    return nil unless mod

    cohorts = visible_cohorts(mod.curriculum_id)
    lessons = mod.all_lessons.order(:release_day, :position, :id).to_a
    blocks = ContentBlock.where(lesson_id: lessons.map(&:id)).to_a
    work_lessons = blocks.select(&:gradable_work_block?).map(&:lesson_id).to_set
    block_ids = blocks.map(&:id)
    submissions = Submission.where(content_block_id: block_ids)
    waiting = waiting_by_cohort(cohorts, submissions)
    attempts = attempts_by_cohort(cohorts, submissions)
    help = help_by_cohort(cohorts, lesson_help_scope(lessons.map(&:id), block_ids))

    {
      type: "module",
      id: mod.id,
      name: mod.name,
      description: mod.description,
      module_type: mod.module_type,
      scheduled_day_names: mod.scheduled_day_names,
      week_count: ((lessons.reject(&:archived?).map(&:release_day).max || 0) / 7) + 1,
      curriculum: names.ref(mod.curriculum),
      can_edit: LessonEditAccess.for(@viewer, mod.curriculum).can_edit?,
      lessons: lessons.map do |lesson|
        day = mod.week_and_day_for(lesson.release_day)
        { id: lesson.id, title: lesson.title, lesson_type: lesson.lesson_type, release_day: lesson.release_day,
          week: day[:week], day_name: day[:day_name], required: lesson.required, archived: lesson.archived?,
          has_work: work_lessons.include?(lesson.id) }
      end,
      cohorts: cohorts.map do |cohort|
        starts = cohort.self_paced? ? nil : mod.start_date_for(cohort)
        last_day = lessons.reject(&:archived?).map(&:release_day).max
        cohort_json(cohort).merge(
          assigned: module_assigned?(cohort, mod),
          starts_on: starts&.iso8601,
          ends_on: starts && last_day ? (starts + mod.calendar_offset_for(last_day)).iso8601 : nil,
          submissions: attempts.fetch(cohort.id, 0),
          waiting: waiting.fetch(cohort.id, 0),
          open_help: help[cohort.id]
        )
      end,
      other_cohorts_count: @other_cohorts_count,
      totals: { submissions: attempts.values.sum, waiting: waiting.values.sum, open_help: help_total(help) }
    }
  end

  # --- Lesson ----------------------------------------------------------------

  def lesson_usage
    lesson = Lesson.eager_load(curriculum_module: :curriculum).find_by(id: @id)
    return nil unless lesson&.curriculum_module

    mod = lesson.curriculum_module
    curriculum = mod.curriculum
    cohorts = visible_cohorts(curriculum.id)
    blocks = lesson.content_blocks.order(:position, :id).to_a
    block_ids = blocks.map(&:id)
    submissions = Submission.where(content_block_id: block_ids)
    waiting = waiting_by_cohort(cohorts, submissions)
    attempts = attempts_by_cohort(cohorts, submissions)
    help_scope = lesson_help_scope([ lesson.id ], block_ids)
    help = help_by_cohort(cohorts, help_scope)
    day = mod.week_and_day_for(lesson.release_day)
    objectives = LearningObjective.joins(:objective_alignments).where(objective_alignments: { lesson_id: lesson.id })
      .order(:position, :code, :id).pluck(:id, :code, :title).uniq

    {
      type: "lesson",
      id: lesson.id,
      title: lesson.title,
      lesson_type: lesson.lesson_type,
      required: lesson.required,
      archived: lesson.archived?,
      release_day: lesson.release_day,
      week: day[:week],
      day_name: day[:day_name],
      curriculum: names.ref(curriculum),
      module: { id: mod.id, name: mod.name },
      can_edit: LessonEditAccess.for(@viewer, curriculum).can_edit?,
      blocks: blocks.map { |block| { id: block.id, block_type: block.block_type, title: block.title, has_work: block.gradable_work_block? } },
      objectives: objectives.map { |id, code, title| { id: id, code: code, title: title } },
      cohorts: cohorts.map do |cohort|
        cohort_json(cohort).merge(
          assigned: module_assigned?(cohort, mod),
          release_date: lesson.archived? || cohort.self_paced? ? nil : lesson.unlock_date(cohort)&.iso8601,
          submissions: attempts.fetch(cohort.id, 0),
          waiting: waiting.fetch(cohort.id, 0),
          open_help: help[cohort.id]
        )
      end,
      other_cohorts_count: @other_cohorts_count,
      help_requests: recent_help(help_scope, cohorts),
      activity: lesson_activity(cohorts, block_ids),
      totals: { submissions: attempts.values.sum, waiting: waiting.values.sum, open_help: help_total(help) }
    }
  end

  # Learner activity on this lesson (L-3.2 "lesson → activity"): videos and
  # checkpoints on its blocks, and work on its exercises, in the cohorts the
  # viewer can see, newest first. An event counts only when it passes the
  # check its own page applies (RecordDetail::ActivityEventPage): its learner
  # is enrolled in the event's cohort, whoever acted is that learner, an
  # admin or one of the cohort's people, and a submission belongs to that
  # learner in that cohort. The cohorts are all on this lesson's curriculum,
  # so a block id can't name another curriculum's lesson. Three queries.
  def lesson_activity(cohorts, block_ids)
    return { count: 0, recent: [] } if cohorts.empty? || block_ids.empty?

    events = ActivityEvent.where(cohort_id: cohorts.map(&:id)).where(<<~SQL.squish, blocks: block_ids, admin: User.roles[:admin])
      ((activity_events.record_type = 'ContentBlock' AND activity_events.record_id IN (:blocks))
        OR (activity_events.record_type = 'Submission' AND EXISTS (
          SELECT 1 FROM submissions JOIN enrollments ON enrollments.id = submissions.enrollment_id
          WHERE submissions.id = activity_events.record_id AND submissions.content_block_id IN (:blocks)
            AND submissions.user_id = activity_events.subject_user_id AND enrollments.cohort_id = activity_events.cohort_id)))
      AND EXISTS (SELECT 1 FROM enrollments WHERE enrollments.user_id = activity_events.subject_user_id AND enrollments.cohort_id = activity_events.cohort_id)
      AND (activity_events.actor_id = activity_events.subject_user_id
        OR EXISTS (SELECT 1 FROM users WHERE users.id = activity_events.actor_id AND users.role = :admin)
        OR EXISTS (SELECT 1 FROM cohort_instructor_assignments WHERE cohort_instructor_assignments.user_id = activity_events.actor_id AND cohort_instructor_assignments.cohort_id = activity_events.cohort_id)
        OR EXISTS (SELECT 1 FROM enrollments WHERE enrollments.user_id = activity_events.actor_id AND enrollments.cohort_id = activity_events.cohort_id))
    SQL
    recent = events.includes(:actor, :subject_user).order(id: :desc).limit(ACTIVITY_LIST_LIMIT).to_a
    {
      count: events.count,
      recent: recent.map do |event|
        { id: event.id, event_type: event.event_type, created_at: event.created_at.iso8601, cohort_id: event.cohort_id,
          actor: { id: event.actor.id, name: event.actor.full_name }, subject: { id: event.subject_user.id, name: event.subject_user.full_name } }
      end
    }
  end

  # The newest open help requests on this lesson in cohorts the viewer can see.
  # Up to five per cohort, newest first, in one query: a page focused on one
  # cohort shows that cohort's newest, and the unfocused page shows the newest
  # five overall (always among these).
  def recent_help(scope, cohorts)
    ids = help_cohort_ids(cohorts)
    return [] if ids.empty?

    ranked = scope.active_queue.where(cohort_id: ids)
      .select("help_requests.id, ROW_NUMBER() OVER (PARTITION BY help_requests.cohort_id ORDER BY help_requests.created_at DESC, help_requests.id DESC) AS cohort_rank")
    newest = HelpRequest.from(ranked, :ranked).where("ranked.cohort_rank <= ?", HELP_LIST_LIMIT).select("ranked.id")
    HelpRequest.where(id: newest).includes(:student).order(created_at: :desc, id: :desc).map do |request|
      { id: request.id, status: request.status, urgency: request.urgency, category: request.category, cohort_id: request.cohort_id,
        created_at: request.created_at.iso8601, student: request.student && { id: request.student.id, name: request.student.full_name } }
    end
  end

  # --- Helpers ---------------------------------------------------------------

  # The cohorts on this curriculum the viewer may see, earliest first, with
  # their module schedules for release dates. Sets @other_cohorts_count.
  def visible_cohorts(curriculum_id)
    all_ids = Cohort.where(curriculum_id: curriculum_id).pluck(:id)
    @visible_ids = @viewer.admin? ? all_ids : all_ids & @viewer.cohort_instructor_assignments.pluck(:cohort_id)
    @other_cohorts_count = all_ids.size - @visible_ids.size
    Cohort.where(id: @visible_ids).includes(:cohort_module_schedules).order(:start_date, :id).to_a
  end

  # Curriculum names with a copy's cohort only when the viewer can see it.
  def names
    @names ||= CurriculumName.new(@viewer)
  end

  def cohort_visible?(cohort_id)
    return true if @viewer.admin?

    @assigned_ids ||= @viewer.cohort_instructor_assignments.pluck(:cohort_id)
    @assigned_ids.include?(cohort_id)
  end

  def cohort_json(cohort)
    { id: cohort.id, name: cohort.name, status: cohort.effective_status, course_delivery: cohort.course_delivery,
      start_date: cohort.start_date&.iso8601, end_date: cohort.end_date&.iso8601, on_sale: cohort.self_paced? && cohort.public_checkout_enabled? }
  end

  # A module counts as assigned unless the cohort's content defaults turn it off.
  def module_assigned?(cohort, mod)
    defaults = cohort.content_defaults
    return true if defaults.nil?

    defaults.dig(mod.id.to_s, "assigned") == true
  end

  # Latest attempts without a grade, per cohort (Grading's "Ungraded").
  def waiting_by_cohort(cohorts, submissions)
    return {} if cohorts.empty?

    submissions.joins(:enrollment).where(enrollments: { cohort_id: cohorts.map(&:id) })
      .latest_attempts.where(grade: nil).group("enrollments.cohort_id").count
  end

  # Every attempt, per cohort (Grading's "All").
  def attempts_by_cohort(cohorts, submissions)
    return {} if cohorts.empty?

    submissions.joins(:enrollment).where(enrollments: { cohort_id: cohorts.map(&:id) }).group("enrollments.cohort_id").count
  end

  # Open help per cohort, only where help requests are switched on (nil elsewhere).
  def help_by_cohort(cohorts, scope)
    ids = help_cohort_ids(cohorts)
    counts = ids.empty? ? {} : scope.active_queue.where(cohort_id: ids).group(:cohort_id).count
    cohorts.to_h { |cohort| [ cohort.id, ids.include?(cohort.id) ? counts.fetch(cohort.id, 0) : nil ] }
  end

  def help_total(help)
    counts = help.values.compact
    counts.empty? ? nil : counts.sum
  end

  def help_cohort_ids(cohorts)
    @school_features ||= FeatureSwitches.school
    cohorts.select { |cohort| FeatureSwitches.for(cohort: cohort, school: @school_features)["help_requests"] }.map(&:id)
  end

  def lesson_help_scope(lesson_ids, block_ids)
    HelpRequest.where(context_type: :lesson, context_id: lesson_ids)
      .or(HelpRequest.where(context_type: :exercise, context_id: block_ids))
  end
end
