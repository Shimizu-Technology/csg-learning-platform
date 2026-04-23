class Lesson < ApplicationRecord
  enum :lesson_type, { video: 0, exercise: 1, reading: 2, project: 3, checkpoint: 4 }

  belongs_to :curriculum_module, foreign_key: :module_id
  has_many :content_blocks, -> { order(:position) }, dependent: :destroy
  has_many :lesson_assignments, dependent: :destroy

  validates :title, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :release_day, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  scope :ordered, -> { order(:position) }

  def primary_assignment_block
    content_blocks.find(&:exercise_like?)
  end

  def completion_blocks
    actionable_blocks = content_blocks.select { |block| block.exercise_like? || block.checkpoint? }
    actionable_blocks.presence || content_blocks.to_a
  end

  def completion_block_ids
    completion_blocks.map(&:id)
  end

  def effective_requires_submission(requires_github: false)
    block = primary_assignment_block
    return requires_submission unless block

    block.review_required?(requires_github: requires_github)
  end

  def effective_submission_type(requires_github: false)
    primary_assignment_block&.effective_submission_type(requires_github: requires_github) || "manual_complete"
  end

  def unlock_date(cohort, module_assignment = nil)
    base_date = if module_assignment&.unlock_date_override.present?
                  module_assignment.unlock_date_override
    else
                  cohort.start_date + curriculum_module.day_offset
    end
    base_date + release_day
  end

  def available?(cohort, module_assignment = nil, lesson_assignment = nil)
    return Date.current >= lesson_assignment.unlock_date_override if lesson_assignment&.unlock_date_override.present?
    return lesson_assignment.unlocked? if lesson_assignment.present?

    if module_assignment
      return false unless module_assignment.accessible?
      return Date.current >= unlock_date(cohort, module_assignment)
    end

    Date.current >= unlock_date(cohort, module_assignment)
  end
end
