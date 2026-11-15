# Moves a lesson to another day or module of the same curriculum, or to
# another place within its day (T-12, W5 PR 5.3 part 2).
#
# Learner data stays attached: the lesson and its blocks keep their ids, so
# progress, submissions, watch credit, quiz attempts and lesson assignments
# still point at the same rows. Moves never leave the curriculum, because
# that would carry one cohort's learner data into another curriculum.
#
# Guards, following the curriculum management rules (#264):
# - The target day must be one the target module teaches on.
# - Moving between modules changes who sees the lesson: learners see a
#   module's lessons through their module assignment (or a lesson
#   assignment). A move that would hide the lesson from a learner who has
#   work in it is refused. Other access changes are reported by the dry run
#   (`preview`) so the editor can confirm them first.
# - `base_updated_at` must match the lesson's version.
#
# Locks, in the #267 order: curriculum, then the source and target modules
# ascending, then every lesson whose place changes ascending, then the moved
# lesson's blocks against learner writes (so a learner can't add work in
# between the access check and the commit).
class LessonMove
  class Invalid < StandardError
    attr_reader :code

    def initialize(message, code: "invalid")
      super(message)
      @code = code
    end
  end

  class Stale < StandardError; end

  def initialize(lesson:, module_id:, release_day:, position:, base_updated_at:)
    @lesson = lesson
    @module_id = integer!(module_id, "module_id")
    @release_day = integer!(release_day, "release_day")
    @position = integer!(position, "position")
    @base_updated_at = base_updated_at
  end

  # Dry run: the same checks and the access impact, with nothing written.
  def preview
    result = nil
    ApplicationRecord.transaction do
      result = prepare!
      raise ActiveRecord::Rollback
    end
    result
  end

  def move!
    ApplicationRecord.transaction do
      impact = prepare!
      if impact[:learners_with_work_losing_access].positive?
        raise Invalid.new(
          "#{ActionController::Base.helpers.pluralize(impact[:learners_with_work_losing_access], 'learner')} with work in this lesson " \
          "#{impact[:learners_with_work_losing_access] == 1 ? "isn't" : "aren't"} assigned \"#{@target.name}\", so the lesson would disappear for them. " \
          "Give them that module first, or move the lesson within \"#{@source.name}\".",
          code: "learner_access"
        )
      end
      apply!
      impact
    end
  end

  private

  def integer!(value, name)
    Integer(value.to_s, 10)
  rescue ArgumentError, TypeError
    raise Invalid.new("#{name} must be a whole number")
  end

  def prepare!
    curriculum_id = @lesson.curriculum_module.curriculum_id
    Curriculum.where(id: curriculum_id).lock.pluck(:id)
    modules = CurriculumModule.where(id: [ @lesson.module_id, @module_id ].uniq).order(:id).lock.index_by(&:id)
    @source = modules.fetch(@lesson.module_id)
    @target = modules[@module_id]
    raise Invalid.new("Choose a module in this lesson's curriculum.", code: "module_mismatch") unless @target&.curriculum_id == curriculum_id

    day_lesson_ids = Lesson.active.where(module_id: @target.id, release_day: @release_day).where.not(id: @lesson.id).pluck(:id)
    locked = Lesson.where(id: (day_lesson_ids + [ @lesson.id ]).sort).order(:id).lock("FOR NO KEY UPDATE").index_by(&:id)
    @lesson = locked.fetch(@lesson.id)
    require_current_version!
    raise Invalid.new("Restore this lesson before moving it.", code: "archived") if @lesson.archived?
    unless @target.valid_release_day?(@release_day)
      raise Invalid.new("\"#{@target.name}\" doesn't meet on that day. Choose one of its scheduled days.", code: "release_day")
    end

    @day_lessons = day_lesson_ids.map { |id| locked.fetch(id) }.sort_by { |lesson| [ lesson.position, lesson.id ] }
    unless @position.between?(0, @day_lessons.length)
      raise Invalid.new("position must be between 0 and #{@day_lessons.length}")
    end

    @block_ids = ContentBlock.lock_against_learner_writes!(@lesson.content_blocks.pluck(:id))
    access_impact
  end

  def require_current_version!
    raise Stale if @base_updated_at.blank? || Time.iso8601(@base_updated_at.to_s) != @lesson.updated_at
  rescue ArgumentError
    raise Stale
  end

  def access_impact
    impact = { learners_losing_access: 0, learners_with_work_losing_access: 0, learners_gaining_access: 0, self_paced_learners: false }
    return impact if @source.id == @target.id

    with_source = ModuleAssignment.where(module_id: @source.id).pluck(:enrollment_id).to_set
    with_target = ModuleAssignment.where(module_id: @target.id).pluck(:enrollment_id).to_set
    with_lesson = LessonAssignment.where(lesson_id: @lesson.id).pluck(:enrollment_id).to_set
    losing = with_source - with_target - with_lesson
    gaining = with_target - with_source - with_lesson

    impact[:learners_losing_access] = losing.size
    impact[:learners_gaining_access] = gaining.size
    impact[:learners_with_work_losing_access] = learners_with_work(losing)
    impact[:self_paced_learners] = Enrollment.active.joins(:cohort)
      .where(id: (losing | gaining).to_a, cohorts: { course_delivery: "self_paced" }).exists?
    impact
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

  def apply!
    @lesson.update!(module_id: @target.id, release_day: @release_day)
    ordered = @day_lessons.dup.insert(@position, @lesson)
    ordered.each_with_index do |lesson, index|
      lesson.update_columns(position: index) unless lesson.position == index
    end
    @lesson.touch
  end
end
