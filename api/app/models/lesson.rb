class Lesson < ApplicationRecord
  enum :lesson_type, { video: 0, exercise: 1, reading: 2, project: 3, checkpoint: 4 }

  belongs_to :curriculum_module, foreign_key: :module_id
  has_many :content_blocks, dependent: :destroy

  validates :title, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :release_day, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }

  default_scope { order(:position) }

  def unlock_date(cohort)
    cohort.start_date + curriculum_module.day_offset + release_day
  end

  def available?(cohort, module_assignment = nil)
    if module_assignment&.unlock_date_override
      Date.current >= module_assignment.unlock_date_override
    else
      Date.current >= unlock_date(cohort)
    end
  end
end
