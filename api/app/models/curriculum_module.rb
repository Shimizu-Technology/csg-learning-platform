class CurriculumModule < ApplicationRecord
  self.table_name = "modules"

  SCHEDULE_PATTERNS = {
    "weekdays" => [ 0, 1, 2, 3, 4 ],       # Mon-Fri
    "weekdays_sat" => [ 0, 1, 2, 3, 4, 5 ], # Mon-Sat (prework with overview day)
    "mwf" => [ 0, 2, 4 ],                   # Mon, Wed, Fri
    "tth" => [ 1, 3 ],                      # Tue, Thu
    "daily" => [ 0, 1, 2, 3, 4, 5, 6 ]      # Every day
  }.freeze

  DAY_NAMES = %w[Monday Tuesday Wednesday Thursday Friday Saturday Sunday].freeze

  enum :module_type, { prework: 0, live_class: 1, capstone: 2, advanced: 3, workshop: 4, recording: 5 }

  belongs_to :curriculum
  has_many :lessons, -> { order(:position) }, foreign_key: :module_id, dependent: :destroy
  has_many :module_assignments, foreign_key: :module_id, dependent: :destroy

  validates :name, presence: true
  validates :position, presence: true, numericality: { only_integer: true, greater_than_or_equal_to: 0 }
  validates :schedule_days, inclusion: { in: SCHEDULE_PATTERNS.keys }, allow_nil: true

  scope :ordered, -> { order(:position) }

  def scheduled_weekday_indices
    SCHEDULE_PATTERNS[schedule_days] || SCHEDULE_PATTERNS["weekdays"]
  end

  def scheduled_day_names
    scheduled_weekday_indices.map { |i| DAY_NAMES[i] }
  end

  def release_day_for(week:, weekday_index:)
    (week - 1) * 7 + weekday_index
  end

  def week_and_day_for(release_day)
    week = (release_day / 7) + 1
    weekday_index = release_day % 7
    { week: week, weekday_index: weekday_index, day_name: DAY_NAMES[weekday_index] }
  end

  def week_count
    max_day = lessons.maximum(:release_day) || 0
    (max_day / 7) + 1
  end
end
