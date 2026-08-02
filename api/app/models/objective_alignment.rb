class ObjectiveAlignment < ApplicationRecord
  belongs_to :learning_objective
  belongs_to :lesson
  belongs_to :content_block, optional: true

  validates :position, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :learning_objective_id, uniqueness: { scope: :content_block_id }, if: :content_block_id?
  validates :learning_objective_id, uniqueness: { scope: :lesson_id }, unless: :content_block_id?
  validate :target_matches_objective_curriculum
  validate :content_block_belongs_to_lesson

  scope :ordered, -> { order(:position, :id) }

  private

  def target_matches_objective_curriculum
    return unless learning_objective && lesson
    return if learning_objective.curriculum_id == lesson.curriculum_module.curriculum_id

    errors.add(:learning_objective, "must belong to the target lesson curriculum")
  end

  def content_block_belongs_to_lesson
    return unless content_block && lesson
    return if content_block.lesson_id == lesson_id

    errors.add(:content_block, "must belong to the target lesson")
  end
end
