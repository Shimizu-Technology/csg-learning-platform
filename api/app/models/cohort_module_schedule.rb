class CohortModuleSchedule < ApplicationRecord
  belongs_to :cohort
  belongs_to :curriculum_module, foreign_key: :module_id

  validates :module_id, uniqueness: { scope: :cohort_id }
  validates :start_date, presence: true
end
