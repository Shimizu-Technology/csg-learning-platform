# A read-only, batched projection of the learners whose currently completed
# lessons would reopen when a new completion block is added. Reuse the same
# definition the learner's outline/percentages use; do not grandfather progress.
class LessonCompletionImpact
  # Visibility limits the breakdown, never the total used for confirmation.
  # Hidden cohorts contribute one distinct-learner aggregate without names/ids.
  def self.for_lesson(lesson, viewer:)
    visible_ids = StaffCohortScope.new(viewer).visible_ids(lesson.curriculum_module.curriculum_id)
    for_lessons([ lesson ], visible_cohort_ids: visible_ids).fetch(lesson.id)
  end

  def self.for_lessons(lessons, visible_cohort_ids: nil)
    lessons = lessons.uniq(&:id)
    return {} if lessons.empty?

    cohorts = Cohort.where(curriculum_id: lessons.map { |lesson| lesson.curriculum_module.curriculum_id }.uniq)
    enrollments = Enrollment.where(cohort_id: cohorts.select(:id))
    school = FeatureSwitches::DEFAULTS.merge((SchoolSetting.find_by(id: 1)&.features || {}).slice(*FeatureSwitches::KEYS))
    projections = LearnerProgress.for_all(enrollments, school_features: school)
    target_ids = lessons.map(&:id).to_set
    completed = Hash.new { |hash, key| hash[key] = {} }
    projections.each_value do |projection|
      enrollment = projection.enrollment
      projection.lessons.each do |lesson|
        next unless target_ids.include?(lesson.id) && projection.lesson_progress(lesson).completed

        bucket = completed[lesson.id][enrollment.cohort_id] ||= { name: enrollment.cohort.name, users: Set.new }
        bucket[:users].add(enrollment.user_id)
      end
    end
    lessons.to_h do |lesson|
      visible, hidden = completed[lesson.id].partition { |id, _| visible_cohort_ids.nil? || visible_cohort_ids.include?(id) }.map(&:to_h)
      cohorts = visible.sort.map do |id, row|
        { id: id, name: row[:name], completed_learners: row[:users].size }
      end
      users = completed[lesson.id].values.reduce(Set.new) { |all, row| all | row[:users] }
      impact = { completed_learners: users.size, cohorts: cohorts }
      unless hidden.empty?
        other_users = hidden.values.reduce(Set.new) { |all, row| all | row[:users] }
        impact[:other_cohorts_completed_learners] = other_users.size
      end
      [ lesson.id, impact ]
    end
  end
end
