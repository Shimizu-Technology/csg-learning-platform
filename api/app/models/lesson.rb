class Lesson < ApplicationRecord
  before_update :preserve_missing_paused_libraries

  def preserve_missing_paused_libraries
    return unless will_save_change_to_release_day? || will_save_change_to_module_id?

    Enrollment.capture_missing_paused_libraries!(Enrollment.joins(:cohort).where(cohorts: { curriculum_id: curriculum_module.curriculum_id }))
  end

  enum :lesson_type, { video: 0, exercise: 1, reading: 2, project: 3, checkpoint: 4 }

  belongs_to :curriculum_module, foreign_key: :module_id
  has_many :content_blocks, -> { order(:position) }, dependent: :destroy
  has_many :lesson_assignments, dependent: :destroy
  has_many :objective_alignments, dependent: :destroy
  has_many :learning_objectives, through: :objective_alignments

  # Runs before the dependent destroys: each block checks its own learner
  # work under FOR UPDATE. The lesson row is locked first and then its blocks
  # in id order (the lesson -> blocks step of CurriculumModule.lock_for_destroy!),
  # so a lesson delete can't deadlock with authors or with learner writes that
  # hold several of these blocks. In a module or curriculum delete these rows
  # are already held.
  before_destroy -> {
    self.class.where(id: id).lock.pluck(:id)
    ContentBlock.lock_against_learner_writes!(ContentBlock.where(lesson_id: id).pluck(:id))
  }, prepend: true

  validates :title, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :release_day, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :release_day_matches_module_schedule

  scope :active, -> { where(archived_at: nil) }
  scope :archived, -> { where.not(archived_at: nil) }
  scope :ordered, -> { order(:release_day, :position, :id) }

  # Every authoring change to a lesson's blocks runs inside this: the lesson
  # row is locked and its updated_at advances when the block returns, so the
  # block editor's base_updated_at check sees edits from every path (legacy
  # block endpoints, mobile's PATCH /lessons/:id/editor, alignments). FOR NO
  # KEY UPDATE still serializes authors but doesn't block learner rows whose
  # foreign keys point at the lesson.
  def with_authoring_lock
    transaction do
      lock!("FOR NO KEY UPDATE")
      result = yield
      touch unless destroyed?
      result
    end
  end

  def archived?
    archived_at.present?
  end

  def archive!
    update!(archived_at: Time.current)
  end

  def restore!
    update!(archived_at: nil)
  end

  def primary_assignment_block
    content_blocks.find(&:exercise_like?) || content_blocks.find(&:submission_checkpoint?)
  end

  def completion_blocks
    actionable_blocks = content_blocks.select { |block| block.exercise_like? || block.checkpoint? }
    actionable_blocks.presence || content_blocks.to_a
  end

  def completion_block_ids
    completion_blocks.map(&:id)
  end

  def effective_requires_submission(requires_github: false, feature_cohort: nil)
    block = primary_assignment_block
    return requires_submission unless block

    ContentBlock::REVIEW_REQUIRED_SUBMISSION_TYPES.include?(block.effective_submission_type(requires_github: requires_github, feature_cohort: feature_cohort))
  end

  def effective_submission_type(requires_github: false, feature_cohort: nil)
    primary_assignment_block&.effective_submission_type(requires_github: requires_github, feature_cohort: feature_cohort) || "manual_complete"
  end

  def unlock_date(cohort, module_assignment = nil)
    return nil if cohort.self_paced?
    # Personal release (W9.1): every lesson opens with its module on the
    # learner's own start; no per-lesson calendar offset.
    return module_assignment ? module_assignment.effective_start_date(cohort) : cohort.start_date if cohort.personal_release?

    base_date = module_assignment&.effective_start_date(cohort) || curriculum_module.start_date_for(cohort)
    base_date + curriculum_module.calendar_offset_for(release_day)
  end

  def assigned_unlock_date(cohort, module_assignment = nil, lesson_assignment = nil)
    return lesson_assignment.unlock_date_override if lesson_assignment&.unlock_date_override.present?
    if lesson_assignment
      return LearningCalendar.today(at: lesson_assignment.created_at) if lesson_assignment.unlocked?

      return nil
    end

    unlock_date(cohort, module_assignment)
  end

  def available?(cohort, module_assignment = nil, lesson_assignment = nil, on: LearningCalendar.today)
    return false if archived?
    if cohort.self_paced?
      return module_assignment.present? || lesson_assignment&.available?(cohort, module_assignment, on: on)
    end
    return on >= lesson_assignment.unlock_date_override if lesson_assignment&.unlock_date_override.present?
    return lesson_assignment.unlocked? if lesson_assignment.present?

    if module_assignment
      return false unless module_assignment.accessible?(cohort, on: on)
      return on >= unlock_date(cohort, module_assignment)
    end

    on >= unlock_date(cohort, module_assignment)
  end

  private

  def release_day_matches_module_schedule
    return if archived?
    return if curriculum_module.blank?
    return if release_day.nil?
    return if curriculum_module.valid_release_day?(release_day)

    errors.add(:release_day, "must match the module schedule")
  end
end
