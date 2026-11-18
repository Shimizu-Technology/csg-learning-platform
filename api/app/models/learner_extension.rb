# Extensions live outside plans: choosing a new pace never erases a grant.
class LearnerExtension < ApplicationRecord
  belongs_to :enrollment
  belongs_to :lesson, optional: true
  belongs_to :curriculum_module, foreign_key: :module_id, optional: true
  belongs_to :granted_by, class_name: "User"

  validates :reason, :submissions_close_at, :granted_at, presence: true
  validates :scope, inclusion: { in: %w[final lesson module] }
  validates :reason, length: { maximum: 4000 }
  validate :target_in_enrollment
  validate :target_immutable
  validate :deadline_does_not_shorten_window

  def target_immutable
    return unless persisted?
    errors.add(:scope, "cannot change the target of an existing grant") if %w[scope lesson_id module_id week_number].any? { |key| will_save_change_to_attribute?(key) }
  end

  def record_change!(actor:, removing: false)
    self.granted_by = actor
    self.granted_at = Time.current
    self.removed_at = removing ? Time.current : nil
    self.revisions = revisions + [ attributes.slice("scope", "lesson_id", "module_id", "week_number", "submissions_close_at", "reason", "granted_by_id", "granted_at", "removed_at").merge("granted_by_name" => actor.full_name) ]
    save!
    move_plan!(actor, removing) if scope == "final"
  end

  def staff_json
    attributes.slice("id", "scope", "lesson_id", "module_id", "week_number", "submissions_close_at", "reason", "granted_by_id", "granted_at", "removed_at", "revisions").merge("granted_by_name" => granted_by.full_name)
  end

  private

  def move_plan!(actor, removing)
    plan = enrollment.learning_plan
    return unless plan&.active? && plan.learner_pace? && plan.target_date
    if removing
      LearnerPace.new(enrollment).regenerate!(actor: actor)
      return
    end

    target = enrollment.learner_extensions.reload.reject(&:removed_at).select { |item| item.scope == "final" }.map { |item| item.submissions_close_at.in_time_zone("Pacific/Guam").to_date }.max
    shift = (target - plan.target_date).to_i
    return unless shift.positive?

    plan.milestones = plan.milestones.map do |milestone|
      date = Date.iso8601(milestone.fetch("due_on"))
      date >= LearningCalendar.today ? milestone.merge("due_on" => (date + shift).iso8601) : milestone
    end
    plan.target_date = target
    plan.save!
    plan.revisions.create!(author: actor, snapshot: plan.snapshot)
  end

  def deadline_does_not_shorten_window
    return unless enrollment && submissions_close_at && !removed_at
    return if persisted? && !will_save_change_to_submissions_close_at?

    context = SubmissionWindowContext.new(enrollment)
    covered = case scope
    when "final" then [ context.final_lesson ].compact
    when "lesson" then [ lesson ].compact
    when "module" then context.lessons.select { |item| item.module_id == module_id && SubmissionWindowStatus.week_number_for_release_day(item.release_day) == week_number }
    else []
    end
    bounded = covered.filter_map { |item| context.close_at(item, except_id: id) }
    previous = submissions_close_at_in_database if persisted?
    # A module grant can extend its final project while soft lessons remain
    # open. A grant with no finite window cannot add time and is refused.
    if bounded.empty? || bounded.any? { |baseline| submissions_close_at <= baseline } || (previous && submissions_close_at < previous)
      errors.add(:submissions_close_at, "must extend the learner's existing deadline; open windows cannot be extended")
    end
  end

  def target_in_enrollment
    return if removed_at

    case scope
    when "final"
      errors.add(:scope, "cannot have a lesson or module") if lesson_id || module_id || week_number
      errors.add(:scope, "requires personal pace") unless enrollment&.cohort&.personal_pace?
    when "lesson"
      errors.add(:lesson, "must be assigned to this learner") unless lesson && enrollment && AssignedLearningContent.new(enrollment).then { |content| content.modules.flat_map { |mod| content.lessons_for(mod) } }.any? { |item| item.id == lesson_id }
      errors.add(:scope, "cannot have a module or week") if module_id || week_number
    when "module"
      errors.add(:curriculum_module, "must be assigned to this learner") unless enrollment&.module_assignments&.any? { |item| item.module_id == module_id }
      errors.add(:week_number, "must be within the module") unless week_number && curriculum_module && week_number.between?(1, curriculum_module.week_count)
      errors.add(:scope, "cannot have a lesson") if lesson_id
    end
  end
end
