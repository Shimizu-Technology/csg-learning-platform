# Learner work rows (progress, submissions, retrieval-check attempts) take a
# shared lock on their content block before they are written, so a block
# delete or type change, which takes the exclusive lock and then reads learner
# evidence, never misses work that commits at the same moment. See
# ContentBlock.lock_for_learner_write!.
module LearnerWorkBlockLock
  extend ActiveSupport::Concern

  included do
    before_save :lock_content_block_for_learner_work
  end

  private

  def lock_content_block_for_learner_work
    ContentBlock.lock_for_learner_write!(learner_work_content_block_id)
  end

  def learner_work_content_block_id
    content_block_id
  end
end
