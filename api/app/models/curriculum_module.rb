class CurriculumModule < ApplicationRecord
  before_update :preserve_missing_paused_libraries

  def preserve_missing_paused_libraries
    return unless will_save_change_to_day_offset? || will_save_change_to_schedule_days?

    Enrollment.capture_missing_paused_libraries!(Enrollment.joins(:cohort).where(cohorts: { curriculum_id: curriculum_id }))
  end

  has_many :github_repository_bindings, dependent: :destroy

  self.table_name = "modules"

  SCHEDULE_PATTERNS = {
    "weekdays" => [ 0, 1, 2, 3, 4 ],       # Mon-Fri
    "weekdays_sat" => [ 0, 1, 2, 3, 4, 5 ], # Mon-Sat (prework with overview day)
    "mwf" => [ 0, 2, 4 ],                   # Mon, Wed, Fri
    "tth" => [ 1, 3 ],                      # Tue, Thu
    "daily" => [ 0, 1, 2, 3, 4, 5, 6 ]      # Every day
  }.freeze

  DAY_NAMES = %w[Monday Tuesday Wednesday Thursday Friday Saturday Sunday].freeze

  enum :module_type, { prework: 0, live_class: 1, capstone: 2, advanced: 3, workshop: 4, recording: 5 }

  belongs_to :curriculum
  has_many :all_lessons,
    -> { order(:release_day, :position, :id) },
    class_name: "Lesson",
    foreign_key: :module_id,
    inverse_of: :curriculum_module,
    dependent: :destroy
  has_many :lessons,
    -> { where(archived_at: nil).order(:release_day, :position, :id) },
    class_name: "Lesson",
    foreign_key: :module_id,
    inverse_of: :curriculum_module
  has_many :module_assignments, foreign_key: :module_id, dependent: :destroy
  has_many :cohort_module_schedules, foreign_key: :module_id, dependent: :destroy

  validates :name, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :schedule_days, inclusion: { in: SCHEDULE_PATTERNS.keys }
  validate :schedule_change_preserves_lesson_release_days

  before_destroy :preserve_learner_data, prepend: true
  after_create :assign_to_active_alumni_enrollments

  scope :ordered, -> { order(:position) }

  # `enrollment_ids` limits the submission counts to those enrollments, for a
  # viewer who may not count other cohorts' work (StaffCohortScope). Whether a
  # module is blocked from deletion always looks at every learner.
  def self.learner_evidence(ids, enrollment_ids: nil)
    lessons = Lesson.where(module_id: ids).select(:id)
    blocks = ContentBlock.where(lesson_id: lessons).select(:id)
    all_submissions = Submission.joins(content_block: :lesson).where(content_block_id: blocks)
    submissions = (enrollment_ids.nil? ? all_submissions : all_submissions.where(enrollment_id: enrollment_ids)).group("lessons.module_id").count
    blocked = (enrollment_ids.nil? ? submissions.keys : all_submissions.distinct.pluck("lessons.module_id")) +
      ModuleAssignment.where(module_id: ids).distinct.pluck(:module_id) +
      LessonAssignment.joins(:lesson).where(lesson_id: lessons).distinct.pluck("lessons.module_id") +
      Progress.joins(content_block: :lesson).where(content_block_id: blocks).distinct.pluck("lessons.module_id") +
      KnowledgeCheckAttempt.joins(knowledge_check: { content_block: :lesson }).where(knowledge_checks: { content_block_id: blocks }).distinct.pluck("lessons.module_id")
    { submissions: submissions, blocked: blocked.to_set }
  end

  # Structural deletes lock top-down, each level in ascending id order:
  # curriculum -> modules -> lessons -> blocks -> knowledge checks. Each level
  # is read after its parents are locked, so no child row can be inserted
  # under it (FK inserts need KEY SHARE on the parent). Authoring (lesson ->
  # its blocks) and learner writes (KEY SHARE on one block, then its check)
  # follow the same order, so none of them can deadlock with a delete.
  def self.lock_for_destroy!(module_ids)
    ids = where(id: module_ids).order(:id).lock.pluck(:id)
    lesson_ids = Lesson.where(module_id: ids).order(:id).lock.pluck(:id)
    block_ids = ContentBlock.lock_against_learner_writes!(ContentBlock.where(lesson_id: lesson_ids).pluck(:id))
    KnowledgeCheck.where(content_block_id: block_ids).order(:id).lock.load
  end

  def submissions_count(enrollment_ids: nil)
    scope = Submission.where(content_block_id: ContentBlock.where(lesson_id: all_lessons.select(:id)).select(:id))
    (enrollment_ids.nil? ? scope : scope.where(enrollment_id: enrollment_ids)).count
  end

  def learner_data?
    blocks = ContentBlock.where(lesson_id: all_lessons.select(:id))
    module_assignments.exists? || LessonAssignment.where(lesson_id: all_lessons.select(:id)).exists? ||
      Submission.where(content_block_id: blocks.select(:id)).exists? ||
      Progress.where(content_block_id: blocks.select(:id)).exists? ||
      KnowledgeCheckAttempt.where(knowledge_check_id: KnowledgeCheck.where(content_block_id: blocks.select(:id)).select(:id)).exists?
  end

  def scheduled_weekday_indices
    SCHEDULE_PATTERNS[schedule_days] || SCHEDULE_PATTERNS["weekdays"]
  end

  def scheduled_day_names
    scheduled_weekday_indices.map { |i| DAY_NAMES[i] }
  end

  def first_scheduled_day_index
    scheduled_weekday_indices.min || 0
  end

  def release_day_for(week:, weekday_index:)
    (week - 1) * 7 + weekday_index
  end

  def week_and_day_for(release_day)
    week = (release_day / 7) + 1
    weekday_index = release_day % 7
    { week: week, weekday_index: weekday_index, day_name: DAY_NAMES[weekday_index] }
  end

  def week_count
    max_day = if lessons.loaded?
                lessons.map(&:release_day).max || 0
    else
                lessons.maximum(:release_day) || 0
    end
    (max_day / 7) + 1
  end

  def valid_release_day?(release_day)
    return false if release_day.nil?

    scheduled_weekday_indices.include?(release_day % 7)
  end

  def calendar_offset_for(release_day)
    release_day - first_scheduled_day_index
  end

  def next_start_date_on_or_after(date)
    current_weekday_index = (date.wday + 6) % 7
    offset = (first_scheduled_day_index - current_weekday_index) % 7
    date + offset
  end

  def start_date_for(cohort)
    cohort.module_schedule_for(self)&.start_date || legacy_start_date_for(cohort)
  end

  def legacy_start_date_for(cohort)
    cohort.start_date + day_offset + first_scheduled_day_index
  end

  private

  def preserve_learner_data
    # Lock referenced parents before checking evidence. Concurrent FK inserts
    # wait for this transaction, rather than arriving after the guard's query.
    # The caller already holds the curriculum (ModulesController#destroy,
    # Curriculum's before_destroy); see lock_for_destroy! for the order.
    lock!
    self.class.lock_for_destroy!([ id ])
    return unless learner_data?

    errors.add(:base, "Cannot delete a module with learner data. Archive its lessons instead.")
    throw :abort
  end

  def assign_to_active_alumni_enrollments
    Enrollment.active
      .joins(:cohort)
      .where(cohorts: { curriculum_id: curriculum_id, cohort_type: Cohort.cohort_types.fetch("alumni") })
      .find_each do |enrollment|
        enrollment.module_assignments.create!(curriculum_module: self, unlocked: true)
      end
  end

  def schedule_change_preserves_lesson_release_days
    return unless will_save_change_to_schedule_days?
    return if id.blank? || SCHEDULE_PATTERNS[schedule_days].blank?

    invalid_count = Lesson.where(module_id: id).count do |lesson|
      !valid_release_day?(lesson.release_day)
    end
    return if invalid_count.zero?

    errors.add(:schedule_days, "would exclude #{invalid_count} restorable #{'lesson'.pluralize(invalid_count)}")
  end
end
