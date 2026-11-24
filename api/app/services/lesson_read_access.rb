# Can a learner open a lesson? The one rule behind GET /api/v1/lessons/:id,
# shared with anything else that would show a learner a lesson's title or link
# (message sources, L-1.8). Staff can always read lessons.
#
# The learner needs a readable enrollment in a cohort on the lesson's
# curriculum (the given cohort when `cohort_id` is set, otherwise their active
# one), the lesson's module or the lesson itself assigned to that enrollment,
# and the lesson released for them.
#
# `check` takes a loaded lesson. `lookup` takes a lesson id and decides from
# only the columns the rule reads, so a record page can refuse a lesson before
# loading anything it would show (see `lookup`).
class LessonReadAccess
  Result = Data.define(:enrollment, :error) do
    def allowed? = error.nil?
  end

  NOT_ACCESSIBLE = "Cannot access this lesson".freeze
  NOT_UNLOCKED = "Lesson is not unlocked yet".freeze

  # How an allowed enrollment loads for a page that goes on to build from it.
  ENROLLMENT_INCLUDES = [ :module_assignments, { cohort: [ :cohort_module_schedules, :cohort_module_submission_windows ] } ].freeze

  # The columns the rule reads, per table. Titles, names, descriptions and
  # steps are not among them.
  LOOKUP_COLUMNS = {
    lesson: %w[id module_id archived_at published release_day created_at],
    module: %w[id curriculum_id day_offset schedule_days],
    enrollment: %w[id user_id cohort_id status paused_at read_cutoff_at paused_lesson_ids paused_library_cutoff_at starts_on first_opened_at],
    cohort: %w[id course_delivery start_date cohort_type learner_pace_weeks],
    module_assignment: %w[id enrollment_id module_id unlocked unlock_date_override availability_changed_at created_at updated_at],
    lesson_assignment: %w[id enrollment_id lesson_id unlocked unlock_date_override availability_changed_at created_at updated_at],
    schedule: %w[id cohort_id module_id start_date]
  }.freeze

  def self.check(user, lesson, cohort_id: nil)
    new(user, lesson, cohort_id: cohort_id).check
  end

  def self.allowed?(user, lesson, cohort_id: nil)
    check(user, lesson, cohort_id: cohort_id).allowed?
  end

  # `check` for several loaded lessons at once, keyed by lesson id. Same rule,
  # but the learner's readable enrollment loads once per curriculum (with all
  # of its lesson assignments) instead of once per lesson, so a list of
  # lesson links costs a fixed number of queries.
  def self.check_many(user, lessons, cohort_id: nil)
    lessons = lessons.uniq
    ActiveRecord::Associations::Preloader.new(records: lessons, associations: :curriculum_module).call
    enrollments = {}
    lessons.to_h { |lesson| [ lesson.id, new(user, lesson, cohort_id: cohort_id).check(enrollments: enrollments) ] }
  end

  # A learner's access to lesson `lesson_id`, or nil when there is no such
  # lesson (or it has no module). Same rule as `check`, decided in at most two
  # queries that read only LOOKUP_COLUMNS: one for the lesson and its module,
  # one for the learner's enrollment with its cohort, this module's schedule
  # and both assignments. A lesson the learner may not open therefore costs
  # one query more than a missing one and never loads what a page would show.
  #
  # The records in the result are partial and read-only: reload what you show
  # (ENROLLMENT_INCLUDES for the enrollment). For learners only; staff can
  # read every lesson.
  def self.lookup(user, lesson_id, cohort_id: nil)
    raise ArgumentError, "lookup is for learners" if user&.staff?

    lesson = Lookup.lesson(lesson_id)
    return nil unless lesson

    new(user, lesson, cohort_id: cohort_id).lookup
  end

  # The rule itself, for a caller that already holds the learner's enrollment
  # and assignments (LearnerProgress): the module is open to them or the lesson
  # is assigned on its own, and the lesson is released for them on `on`.
  def self.readable?(enrollment, lesson, assignment, lesson_assignment, on: LearningCalendar.today)
    return false if lesson.archived? || lesson.draft?
    return false unless enrollment.module_reachable_for_read?(assignment, on: on) || lesson_assignment.present?

    enrollment.lesson_available_for_read?(lesson, assignment, lesson_assignment, on: on)
  end

  def initialize(user, lesson, cohort_id: nil)
    @user = user
    @lesson = lesson
    @cohort_id = cohort_id
  end

  # `enrollments` is check_many's per-curriculum cache; leave it nil for one lesson.
  def check(enrollments: nil)
    return Result.new(enrollment: nil, error: NOT_ACCESSIBLE) unless @user && @lesson
    return Result.new(enrollment: nil, error: nil) if @user.staff?
    return denied if @lesson.archived? || @lesson.draft?
    return check_with_cached_enrollment(enrollments) if enrollments

    enrollment = readable_enrollments.includes(*ENROLLMENT_INCLUDES).first
    return denied unless enrollment

    decide(enrollment, enrollment.module_assignments.find_by(module_id: @lesson.module_id), enrollment.lesson_assignments.find_by(lesson_id: @lesson.id))
  end

  def lookup
    return Result.new(enrollment: nil, error: NOT_ACCESSIBLE) unless @user
    return denied if @lesson.archived? || @lesson.draft?

    enrollment, assignment, lesson_assignment = Lookup.enrollment(readable_enrollments, @lesson)
    return denied unless enrollment

    decide(enrollment, assignment, lesson_assignment)
  end

  private

  # Assignments are unique per enrollment and module or lesson, so finding
  # them in the loaded lists matches the find_by calls in `check`.
  def check_with_cached_enrollment(enrollments)
    curriculum_id = @lesson.curriculum_module&.curriculum_id
    enrollment = enrollments.fetch(curriculum_id) do
      enrollments[curriculum_id] = readable_enrollments.includes(*ENROLLMENT_INCLUDES, :lesson_assignments).first
    end
    return denied unless enrollment

    assignment = enrollment.module_assignments.detect { |record| record.module_id == @lesson.module_id }
    lesson_assignment = enrollment.lesson_assignments.detect { |record| record.lesson_id == @lesson.id }
    decide(enrollment, assignment, lesson_assignment)
  end

  def decide(enrollment, assignment, lesson_assignment)
    return denied(enrollment) unless enrollment.module_reachable_for_read?(assignment) || lesson_assignment.present?
    return Result.new(enrollment: enrollment, error: nil) if self.class.readable?(enrollment, @lesson, assignment, lesson_assignment)

    Result.new(enrollment: enrollment, error: NOT_UNLOCKED)
  end

  def denied(enrollment = nil)
    Result.new(enrollment: enrollment, error: NOT_ACCESSIBLE)
  end

  # Newest first; the caller takes the first.
  def readable_enrollments
    enrollments = @user.enrollments
      .joins(:cohort)
      .where(cohorts: { curriculum_id: @lesson.curriculum_module&.curriculum_id })
    enrollments = if @cohort_id.present?
      enrollments.with_read_access.where(cohort_id: @cohort_id)
    else
      enrollments.active
    end
    enrollments.order(enrolled_at: :desc, id: :desc)
  end

  # Builds the partial, read-only records `lookup` decides on, each from one
  # joined row, with their associations already set so the model rules
  # (Lesson#available?, ModuleAssignment#accessible?,
  # Enrollment#lesson_available_for_read?) run without another query.
  # strict_loading turns any association the rules start to need into an
  # error instead of a silent extra query.
  module Lookup
    module_function

    def lesson(lesson_id)
      rows = row(Lesson.joins(:curriculum_module).where(id: lesson_id), lesson: "lessons", module: "modules")
      return nil unless rows

      mod = build(CurriculumModule, rows[:module])
      lesson = build(Lesson, rows[:lesson])
      lesson.association(:curriculum_module).target = mod
      lesson
    end

    def enrollment(relation, lesson)
      relation = relation
        .joins(Enrollment.sanitize_sql_array([ "LEFT JOIN module_assignments ON module_assignments.enrollment_id = enrollments.id AND module_assignments.module_id = ?", lesson.module_id ]))
        .joins(Enrollment.sanitize_sql_array([ "LEFT JOIN lesson_assignments ON lesson_assignments.enrollment_id = enrollments.id AND lesson_assignments.lesson_id = ?", lesson.id ]))
        .joins(Enrollment.sanitize_sql_array([ "LEFT JOIN cohort_module_schedules ON cohort_module_schedules.cohort_id = cohorts.id AND cohort_module_schedules.module_id = ?", lesson.module_id ]))
      rows = row(relation, enrollment: "enrollments", cohort: "cohorts", module_assignment: "module_assignments", lesson_assignment: "lesson_assignments", schedule: "cohort_module_schedules")
      return nil unless rows

      mod = lesson.curriculum_module
      cohort = build(Cohort, rows[:cohort])
      enrollment = build(Enrollment, rows[:enrollment])
      enrollment.association(:cohort).target = cohort
      schedule = rows[:schedule]["id"] && build(CohortModuleSchedule, rows[:schedule])
      cohort.association(:cohort_module_schedules).target = schedule ? [ schedule ] : []

      assignment = rows[:module_assignment]["id"] && build(ModuleAssignment, rows[:module_assignment])
      assignment&.association(:enrollment)&.target = enrollment
      assignment&.association(:curriculum_module)&.target = mod
      lesson_assignment = rows[:lesson_assignment]["id"] && build(LessonAssignment, rows[:lesson_assignment])
      lesson_assignment&.association(:enrollment)&.target = enrollment
      lesson_assignment&.association(:lesson)&.target = lesson
      [ enrollment, assignment, lesson_assignment ]
    end

    # One row of `relation` with LOOKUP_COLUMNS for each table, split by table.
    def row(relation, tables)
      columns = tables.flat_map do |key, table|
        LOOKUP_COLUMNS.fetch(key).map { |column| "#{table}.#{column} AS #{key}__#{column}" }
      end
      raw = relation.connection.select_one(relation.select(columns).limit(1).arel, "LessonReadAccess")
      return nil unless raw

      tables.keys.index_with { |key| raw.select { |name, _| name.start_with?("#{key}__") }.transform_keys { |name| name.delete_prefix("#{key}__") } }
    end

    def build(model, attributes)
      model.instantiate(attributes).tap do |record|
        record.readonly!
        record.strict_loading!
      end
    end
  end
  private_constant :Lookup
end
