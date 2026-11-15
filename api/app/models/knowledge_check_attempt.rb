class KnowledgeCheckAttempt < ApplicationRecord
  include LearnerWorkBlockLock

  belongs_to :enrollment, optional: true
  belongs_to :knowledge_check
  belongs_to :user

  validates :selected_option, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validate :selected_option_exists

  private

  def learner_work_content_block_id
    knowledge_check&.content_block_id
  end

  def selected_option_exists
    return if selected_option.nil? || selected_option < knowledge_check&.options.to_a.length

    errors.add(:selected_option, "must identify one of the choices")
  end
end
