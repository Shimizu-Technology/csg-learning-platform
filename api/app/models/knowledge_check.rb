class KnowledgeCheck < ApplicationRecord
  belongs_to :content_block
  belongs_to :learning_objective, optional: true
  has_many :attempts, class_name: "KnowledgeCheckAttempt", dependent: :restrict_with_error

  validates :prompt, presence: true, length: { maximum: 1_000 }
  validates :explanation, presence: true, length: { maximum: 2_000 }
  validates :correct_option, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :valid_options
  validate :checkpoint_block
  validate :objective_matches_curriculum
  validate :changes_preserve_attempt_evidence, on: :update

  def correct_option?(selected_option)
    selected_option == correct_option
  end

  private

  def valid_options
    unless options.is_a?(Array) && options.length.between?(2, 6) && options.all? { |option| option.is_a?(String) && option.strip.present? && option.length <= 300 }
      errors.add(:options, "must contain 2 to 6 non-empty choices of at most 300 characters")
      return
    end
    errors.add(:correct_option, "must identify one of the choices") unless correct_option.to_i < options.length
  end

  def checkpoint_block
    errors.add(:content_block, "must be a checkpoint") unless content_block&.checkpoint?
  end

  def objective_matches_curriculum
    return if learning_objective.nil? || learning_objective.curriculum_id == content_block&.lesson&.curriculum_module&.curriculum_id

    errors.add(:learning_objective, "must belong to the lesson curriculum")
  end

  def changes_preserve_attempt_evidence
    return unless has_changes_to_save? && attempts.exists?

    errors.add(:base, "Check cannot be changed after students have attempted it")
  end
end
