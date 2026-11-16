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
# - A move can change who can open the lesson today: a module's lessons open
#   through the learner's module assignment and that module's schedule (or a
#   lesson assignment), and a lesson's day sets when it opens. Access is
#   decided before and after with the rule the lesson page and the learner's
#   progress use (LessonAccessImpact, built on LessonReadAccess.readable?).
#   The block editor applies the same rule to a day change.
#   A move that would take the lesson away from a learner who has work in it
#   is refused, between modules or to a later day. Other access changes are
#   reported by the dry run (`preview`), which runs the same calculation, so
#   the editor can confirm them first.
# - `base_updated_at` must match the lesson's version.
# - `expected_impact`, when given, is the impact the person confirmed from a
#   dry run. The move recomputes it under its locks and is refused
#   (ImpactChanged, with the new impact) when it differs, so a dry run for
#   other parameters, or one that learner or schedule changes have since made
#   stale, can't authorize this move.
#
# Locks, in the order Curriculum.lock_for_content! documents: curriculum
# FOR UPDATE, then the source and target modules
# ascending, then every lesson whose place changes ascending, then the moved
# lesson's blocks against learner writes (so a learner can't add work in
# between the access check and the commit). A learner write that waited on
# those blocks decides access again once it holds its block lock
# (ApplicationController#recheck_content_block_write!), so it can't record
# work on a lesson this move just hid from that learner.
class LessonMove
  class Invalid < StandardError
    attr_reader :code

    def initialize(message, code: "invalid")
      super(message)
      @code = code
    end
  end

  class Stale < StandardError; end

  class ImpactChanged < StandardError
    attr_reader :impact

    def initialize(impact)
      super("Who can open this lesson changed since you checked. Review the new numbers, then move it again.")
      @impact = impact
    end
  end

  # The parts of the impact a person confirms before moving.
  CONFIRMED_IMPACT = %i[learners_losing_access learners_gaining_access self_paced_learners].freeze

  def initialize(lesson:, module_id:, release_day:, position:, base_updated_at:, expected_impact: nil)
    @lesson = lesson
    @module_id = integer!(module_id, "module_id")
    @release_day = integer!(release_day, "release_day")
    @position = integer!(position, "position")
    @base_updated_at = base_updated_at
    @expected_impact = expected_impact && parse_expected_impact(expected_impact)
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
        count = impact[:learners_with_work_losing_access]
        raise Invalid.new(
          "#{ActionController::Base.helpers.pluralize(count, 'learner')} with work in this lesson " \
          "couldn't open it in \"#{@target.name}\" on that day: the module isn't assigned to them, that day hasn't opened for them yet, " \
          "or it falls after their pause. Give them access there first, or choose a module and day that are already open to them.",
          code: "learner_access"
        )
      end
      raise ImpactChanged.new(impact) if @expected_impact && @expected_impact != impact.slice(*CONFIRMED_IMPACT)

      apply!
      impact
    end
  end

  private

  def parse_expected_impact(value)
    raise Invalid.new("expected_impact must be an object") unless value.is_a?(Hash)

    value = value.with_indifferent_access
    {
      learners_losing_access: integer!(value[:learners_losing_access], "expected_impact.learners_losing_access"),
      learners_gaining_access: integer!(value[:learners_gaining_access], "expected_impact.learners_gaining_access"),
      self_paced_learners: ActiveModel::Type::Boolean.new.cast(value[:self_paced_learners]) == true
    }
  end

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

  # Learners whose access to the lesson today changes (LessonAccessImpact),
  # counted under the locks prepare! took.
  def access_impact
    LessonAccessImpact.new(lesson: @lesson, source: @source, target: @target, release_day: @release_day, block_ids: @block_ids).call
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
