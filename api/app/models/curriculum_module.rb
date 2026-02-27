class CurriculumModule < ApplicationRecord
  self.table_name = "modules"

  enum :module_type, { prework: 0, live_class: 1, capstone: 2, advanced: 3, workshop: 4, recording: 5 }

  belongs_to :curriculum
  has_many :lessons, foreign_key: :module_id, dependent: :destroy
  has_many :module_assignments, foreign_key: :module_id, dependent: :destroy

  validates :name, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  default_scope { order(:position) }
end
