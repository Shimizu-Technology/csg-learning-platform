# One content id a cohort copy replaced (CurriculumCopyForCohort): the shared
# curriculum's old_id is the copy's new_id for this cohort only. Read through
# MovedContent, which applies a redirect only when the viewer can't reach the
# old record directly.
class ContentRedirect < ApplicationRecord
  RECORD_TYPES = %w[CurriculumModule Lesson ContentBlock KnowledgeCheck].freeze

  belongs_to :curriculum_copy
  belongs_to :cohort

  validates :record_type, inclusion: { in: RECORD_TYPES }
end
