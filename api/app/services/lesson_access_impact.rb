# Whose access to a lesson today changes when it moves to another module or
# day (LessonMove, and a day change saved in the block editor). Every
# enrollment that can read the curriculum is checked twice with the rule the
# lesson page and the learner's progress use (LessonReadAccess.readable?:
# module schedules and start overrides, lesson assignment overrides, paused
# learners' read cutoffs): the lesson where it is, and the same lesson in
# `target` on `release_day`.
#
# The caller holds the locks that keep the answer true until commit: the
# curriculum FOR UPDATE (cohort and availability changes wait), the modules,
# the lesson, and the lesson's blocks against learner writes (`block_ids`, so
# no learner adds work between this count and the commit).
class LessonAccessImpact
  def initialize(lesson:, source:, target:, release_day:, block_ids:)
    @lesson = lesson
    @source = source
    @target = target
    @release_day = release_day
    @block_ids = block_ids
  end

  def call
    impact = { learners_losing_access: 0, learners_with_work_losing_access: 0, learners_gaining_access: 0, self_paced_learners: false }
    return impact if @source.id == @target.id && @lesson.release_day == @release_day

    @lesson.association(:curriculum_module).target = @source
    moved = moved_lesson
    today = LearningCalendar.today
    enrollments = Enrollment.with_read_access.joins(:cohort)
      .where(cohorts: { curriculum_id: @source.curriculum_id })
      .includes(cohort: :cohort_module_schedules).order(:id).to_a
    ids = enrollments.map(&:id)
    module_assignments = ModuleAssignment.where(enrollment_id: ids, module_id: [ @source.id, @target.id ].uniq).to_a
    module_assignments.each { |assignment| assignment.association(:curriculum_module).target = assignment.module_id == @source.id ? @source : @target }
    module_assignments = module_assignments.group_by(&:enrollment_id)
    lesson_assignments = LessonAssignment.where(enrollment_id: ids, lesson_id: @lesson.id).index_by(&:enrollment_id)

    losing = Set.new
    gaining = Set.new
    enrollments.each do |enrollment|
      assignments = module_assignments.fetch(enrollment.id, []).index_by(&:module_id)
      assignments.each_value { |assignment| assignment.association(:enrollment).target = enrollment }
      lesson_assignment = lesson_assignments[enrollment.id]
      before = LessonReadAccess.readable?(enrollment, @lesson, assignments[@source.id], lesson_assignment, on: today)
      after = LessonReadAccess.readable?(enrollment, moved, assignments[@target.id], lesson_assignment, on: today)
      next if before == after

      (before ? losing : gaining) << enrollment.id
    end

    impact[:learners_losing_access] = losing.size
    impact[:learners_gaining_access] = gaining.size
    impact[:learners_with_work_losing_access] = learners_with_work(losing)
    impact[:self_paced_learners] = enrollments.any? { |enrollment| (losing.include?(enrollment.id) || gaining.include?(enrollment.id)) && enrollment.active? && enrollment.cohort.self_paced? }
    impact
  end

  private

  # The locked lesson as it would be after the move, unsaved and read-only.
  def moved_lesson
    lesson = Lesson.instantiate(@lesson.attributes.merge("module_id" => @target.id, "release_day" => @release_day))
    lesson.association(:curriculum_module).target = @target
    lesson.readonly!
    lesson
  end

  # Enrollments among `enrollment_ids` with any progress, submission or quiz
  # attempt on the lesson, counting legacy rows saved without an enrollment
  # by their user.
  def learners_with_work(enrollment_ids)
    return 0 if enrollment_ids.empty?

    enrollments = Enrollment.where(id: enrollment_ids.to_a).pluck(:id, :user_id)
    check_ids = KnowledgeCheck.where(content_block_id: @block_ids).select(:id)
    by_enrollment = Set.new
    by_user = Set.new
    [ Progress.where(content_block_id: @block_ids), Submission.where(content_block_id: @block_ids), KnowledgeCheckAttempt.where(knowledge_check_id: check_ids) ].each do |scope|
      scope.distinct.pluck(:enrollment_id, :user_id).each do |enrollment_id, user_id|
        enrollment_id ? by_enrollment << enrollment_id : by_user << user_id
      end
    end
    enrollments.count { |id, user_id| by_enrollment.include?(id) || by_user.include?(user_id) }
  end
end
